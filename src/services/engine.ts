import type { DeviceRuntimeStats, EngineStats, Falloff, LEDStrip, ResolvedParams } from '../types/voxel';
import type { VoxelStore } from '../state/useVoxelStore';
import { CHIPSETS, DDP_SEND_HZ, LIMITER_RATIO, MAX_LEDS, TARGET_META } from './catalog';
import { buildLayout, type LedLayout } from './geometry';
import { falloffWeight, grayBit, resolveParams, routeOutput, shadeInto, strobeLevel, type ChannelValues, type ModSums } from './shaderMath';
import { SensorPipeline, sensorIdOf } from './sensors';
import { bridgeMode, encodeDdpPackets, sendDdpFrame } from './tauriBridge';

export interface DeviceFrame {
  rgb: Uint8Array;
  packets: Uint8Array[];
  sequence: number;
  sentAt: number;
}

/**
 * Mutable runtime shared with the WebGL viewport, scanner and inspectors.
 * Written every animation frame, never stored in React state.
 */
export const runtime = {
  layout: buildLayout([]) as LedLayout,
  layoutVersion: 0,
  /** Final linear RGB per LED (0..1) after brightness, strobe and current limiting. */
  colors: new Float32Array(MAX_LEDS * 3),
  params: { origin: [0, 1.2, 0], radius: 1, speed: 1, hueShift: 0, masterBrightness: 1, strobe: false } as ResolvedParams,
  mods: {} as ModSums,
  /** Normalized sensor channel values (0..1), refreshed at SENSOR_HZ. */
  sensorValues: {} as ChannelValues,
  time: 0,
  phase: 0,
  frames: new Map<string, DeviceFrame>(),
  sendErrors: 0,
  lastError: '',
};

const SENSOR_HZ = 20;
/** Local wave ring: propagation speed (m/s) and gaussian width (m). */
const WAVE_SPEED = 3.5;
const WAVE_WIDTH = 0.15;

interface SpatialField {
  wave: boolean;
  x: number;
  y: number;
  z: number;
  radius: number;
  falloff: Falloff;
  /** local_intensity: signed route output. */
  value: number;
  /** local_wave: ring distance from the sensor and its amplitude. */
  ring: number;
  amp: number;
}

const BASE_RSSI: Record<string, number> = { 'esp-salon': -52, 'esp-plafond': -61, 'esp-telemetry': -67 };

interface DeviceCounters {
  frames: number;
  latencySum: number;
  latencyN: number;
  packets: number;
}

export function startEngine(store: VoxelStore): () => void {
  let raf = 0;
  let last = performance.now();
  let lastStrips: LEDStrip[] | null = null;
  let lastSend = 0;
  let lastStats = performance.now();
  let renderFrames = 0;
  let ddpFrames = 0;
  const sequences = new Map<string, number>();
  const counters = new Map<string, DeviceCounters>();
  const deviceAmps = new Map<string, { amps: number; watts: number; limited: boolean }>();
  const waves = new Map<string, { last: number; list: { t0: number; amp: number }[] }>();

  const counter = (id: string) => {
    let c = counters.get(id);
    if (!c) counters.set(id, (c = { frames: 0, latencySum: 0, latencyN: 0, packets: 0 }));
    return c;
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    renderFrames++;

    const s = store.getState();
    if (s.strips !== lastStrips) {
      runtime.layout = buildLayout(s.strips);
      runtime.layoutVersion++;
      lastStrips = s.strips;
    }
    const { layout, colors } = runtime;
    const { params, mods } = resolveParams(s.params, s.routes, runtime.sensorValues, s.manualStrobe);
    runtime.params = params;
    runtime.mods = mods;
    runtime.time += dt;
    runtime.phase += dt * params.speed;

    const strobe = params.strobe ? strobeLevel(runtime.time) : -1;
    const gain = params.masterBrightness;
    const pos = layout.positions;

    // Spatial fields: routes to local_* targets, centered on their source sensor.
    const fields: SpatialField[] = [];
    for (const r of s.routes) {
      if (!r.enabled || !TARGET_META[r.target].spatial) continue;
      const sensor = s.sensors.find((x) => x.id === sensorIdOf(r.source));
      if (!sensor || !sensor.enabled) continue;
      const v = routeOutput(r, runtime.sensorValues);
      const [x, y, z] = sensor.position;
      const base = { x, y, z, radius: sensor.radius, falloff: sensor.falloff };
      if (r.target === 'local_intensity') {
        if (v !== 0) fields.push({ ...base, wave: false, value: v, ring: 0, amp: 0 });
        continue;
      }
      let w = waves.get(r.id);
      if (!w) waves.set(r.id, (w = { last: 0, list: [] }));
      if (v > 0.5 && w.last <= 0.5) w.list.push({ t0: runtime.time, amp: Math.min(1, v) });
      w.last = v;
      w.list = w.list.filter((e) => (runtime.time - e.t0) * WAVE_SPEED < sensor.radius);
      for (const e of w.list) {
        const ring = (runtime.time - e.t0) * WAVE_SPEED;
        fields.push({ ...base, wave: true, value: 0, ring, amp: e.amp * (1 - ring / sensor.radius) });
      }
    }
    const waveDen = 2 * WAVE_WIDTH * WAVE_WIDTH;

    // 1. Shade every LED.
    for (const r of layout.ranges) {
      const end = r.start + r.count;
      for (let i = r.start; i < end; i++) {
        const k = i * 3;
        if (!r.visible) {
          colors[k] = colors[k + 1] = colors[k + 2] = 0;
        } else if (s.scan.active) {
          const v = grayBit(i, s.scan.bit) ? 1 : 0;
          colors[k] = colors[k + 1] = colors[k + 2] = v;
        } else if (strobe >= 0) {
          colors[k] = colors[k + 1] = colors[k + 2] = strobe * gain;
        } else {
          const x = pos[k], y = pos[k + 1], z = pos[k + 2];
          shadeInto(colors, k, s.shader, x, y, z, runtime.phase, params);
          let mul = 1;
          let add = 0;
          for (const f of fields) {
            const dx = x - f.x, dy = y - f.y, dz = z - f.z;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (f.wave) {
              if (d < f.radius) {
                const e = d - f.ring;
                add += f.amp * Math.exp(-(e * e) / waveDen);
              }
            } else {
              mul += f.value * TARGET_META.local_intensity.range * falloffWeight(f.falloff, d, f.radius);
            }
          }
          if (mul < 0) mul = 0;
          add *= 0.85;
          // Clamp: values above 1 would wrap in the Uint8Array DDP payload.
          colors[k] = Math.min(1, (colors[k] * mul + add) * gain);
          colors[k + 1] = Math.min(1, (colors[k + 1] * mul + add) * gain);
          colors[k + 2] = Math.min(1, (colors[k + 2] * mul + add) * gain);
        }
      }
    }

    // 2. Electrical load per device, with WLED-style automatic brightness limiter.
    deviceAmps.clear();
    for (const d of s.devices) {
      let watts = 0;
      for (const r of layout.ranges) {
        if (r.deviceId !== d.id) continue;
        const spec = CHIPSETS[r.chipset];
        let ma = 0;
        for (let i = r.start, e = r.start + r.count; i < e; i++) {
          const k = i * 3;
          ma += ((colors[k] + colors[k + 1] + colors[k + 2]) / 3) * spec.maFullWhite + spec.maIdle;
        }
        watts += (ma / 1000) * spec.voltage;
      }
      let amps = watts / d.psuVoltage;
      const limit = d.psuMaxAmps * LIMITER_RATIO;
      let limited = false;
      if (d.currentLimiter && amps > limit && amps > 0) {
        const scale = limit / amps;
        for (const r of layout.ranges) {
          if (r.deviceId !== d.id) continue;
          for (let k = r.start * 3, e = (r.start + r.count) * 3; k < e; k++) colors[k] *= scale;
        }
        watts *= scale;
        amps = limit;
        limited = true;
      }
      deviceAmps.set(d.id, { amps, watts, limited });
    }

    // 3. DDP output at a fixed rate, one frame per DDP device.
    if (now - lastSend >= 1000 / DDP_SEND_HZ) {
      lastSend = now;
      ddpFrames++;
      for (const d of s.devices) {
        if (d.protocol !== 'DDP') continue;
        let n = 0;
        for (const r of layout.ranges) if (r.deviceId === d.id) n += r.count;
        if (n === 0) continue;
        const rgb = new Uint8Array(n * 3);
        let o = 0;
        for (const r of layout.ranges) {
          if (r.deviceId !== d.id) continue;
          for (let k = r.start * 3, e = (r.start + r.count) * 3; k < e; k++) rgb[o++] = Math.round(colors[k] * 255);
        }
        const sequence = ((sequences.get(d.id) ?? 0) % 15) + 1;
        sequences.set(d.id, sequence);
        runtime.frames.set(d.id, { rgb, packets: encodeDdpPackets(rgb, sequence), sequence, sentAt: now });
        if (!s.ddpOutput || !d.online) continue;
        const c = counter(d.id);
        sendDdpFrame(d.ip, d.port, rgb, sequence)
          .then((rep) => {
            c.frames++;
            c.packets = rep.packets;
            c.latencySum += rep.latencyMs;
            c.latencyN++;
          })
          .catch((err: unknown) => {
            runtime.sendErrors++;
            runtime.lastError = String(err);
          });
      }
    }

    // 4. Publish aggregated stats to React at 4 Hz.
    const elapsed = now - lastStats;
    if (elapsed >= 250) {
      const devices: Record<string, DeviceRuntimeStats> = {};
      let totalWatts = 0;
      let a12 = 0;
      let a5 = 0;
      for (const d of s.devices) {
        const load = deviceAmps.get(d.id) ?? { amps: 0, watts: 0, limited: false };
        const c = counter(d.id);
        totalWatts += load.watts;
        if (d.psuVoltage === 12) a12 += load.amps;
        else a5 += load.amps;
        const base = BASE_RSSI[d.id] ?? -64;
        devices[d.id] = {
          fps: (c.frames * 1000) / elapsed,
          latencyMs: c.latencyN ? c.latencySum / c.latencyN : 0,
          amps: load.amps,
          watts: load.watts,
          limited: load.limited,
          packetsPerFrame: c.packets,
          rssi: bridgeMode === 'web' ? Math.round(base + Math.sin(now / 1700 + base) * 3) : Number.NaN,
        };
        c.frames = 0;
        c.latencySum = 0;
        c.latencyN = 0;
      }
      let active = 0;
      for (const r of layout.ranges) if (r.visible) active += r.count;
      const stats: EngineStats = {
        renderFps: (renderFrames * 1000) / elapsed,
        ddpFps: s.ddpOutput ? (ddpFrames * 1000) / elapsed : 0,
        totalWatts,
        totalAmps12: a12,
        totalAmps5: a5,
        activeVoxels: active,
        effectiveRadius: params.radius,
        effectiveSpeed: params.speed,
        effectiveHueShift: params.hueShift,
        effectiveBrightness: params.masterBrightness,
        strobeActive: params.strobe,
        devices,
      };
      renderFrames = 0;
      ddpFrames = 0;
      lastStats = now;
      store.setState({ stats });
    }
  };
  raf = requestAnimationFrame(frame);

  // Sensor tick: every source, simulated or real, goes through the same pipeline.
  const pipeline = new SensorPipeline();
  let sensorT = 0;
  const sensorDt = 1 / SENSOR_HZ;
  const sim = window.setInterval(() => {
    sensorT += sensorDt;
    const values = pipeline.tick(store.getState().sensors, sensorT, sensorDt);
    runtime.sensorValues = values;
    store.setState({ sensorValues: values });
  }, 1000 / SENSOR_HZ);

  return () => {
    cancelAnimationFrame(raf);
    window.clearInterval(sim);
    pipeline.dispose();
  };
}
