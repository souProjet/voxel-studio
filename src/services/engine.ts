import type { DeviceRuntimeStats, EngineStats, Falloff, LEDStrip, ResolvedParams, Vec3 } from '../types/voxel';
import type { VoxelStore } from '../state/useVoxelStore';
import { CHIPSETS, DDP_SEND_HZ, EFFECT_DEFAULTS, isSpatialTarget, LIMITER_RATIO, MAX_LEDS, ROOM, TARGET_META } from './catalog';
import { buildLayout, COLOR_ORDER_INDEX, type LedLayout } from './geometry';
import { clamp, falloffWeight, grayBit, resolveParams, routeOutput, strobeLevel, type ChannelValues, type ModSums, type RouteOutputs } from './shaderMath';
import { LayerRenderer, type LayerDraw } from './layerRenderer';
import { hexToRgb, layerTarget, OPACITY_KEY, parseParams } from './layers';
import { GeneratorBank } from './generators';
import { inputs, syncInputs } from './inputs';
import { SensorPipeline, sensorIdOf } from './sensors';
import { bridgeMode, encodeDdpPackets, probeDevice, sendDdpFrame } from './tauriBridge';

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
  params: { origin: [0, 1.2, 0], radius: 1, speed: 1, hueShift: 0, masterBrightness: 1, strobe: false, ...EFFECT_DEFAULTS } as ResolvedParams,
  mods: {} as ModSums,
  /** Normalized sensor channel values (0..1), refreshed at SENSOR_HZ. */
  sensorValues: {} as ChannelValues,
  /** Sensor values plus generator outputs, refreshed every frame. */
  channelValues: {} as ChannelValues,
  /** Smoothed route outputs keyed by route id. */
  routeOutputs: {} as RouteOutputs,
  time: 0,
  phase: 0,
  /** Beats elapsed at the scene tempo. */
  beat: 0,
  frames: new Map<string, DeviceFrame>(),
};

const SENSOR_HZ = 20;
const PROBE_INTERVAL_MS = 3000;
/**
 * Output clock. requestAnimationFrame stops when the window is hidden or minimized, which
 * would freeze the LEDs mid-show. A dedicated worker posts ticks at the DDP rate (worker
 * timers are not throttled like page timers); a tick runs a frame only when rAF has not.
 */
const CLOCK_WORKER_SRC = `setInterval(() => postMessage(0), ${Math.round(1000 / DDP_SEND_HZ)});`;
const RAF_STALL_MS = 60;
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
  errors: number;
  lastError: string;
}

export function startEngine(store: VoxelStore): () => void {
  let raf = 0;
  let last = performance.now();
  /** Last time requestAnimationFrame drove a frame; the worker clock takes over when it stalls. */
  let lastRafAt = 0;
  let lastStrips: LEDStrip[] | null = null;
  const generators = new GeneratorBank();
  let renderer: LayerRenderer | null = null;
  try {
    renderer = new LayerRenderer();
  } catch (e) {
    store.setState({ notice: { id: Date.now(), text: `GPU: ${e instanceof Error ? e.message : String(e)}`, tone: 'error' } });
  }
  let rendererLayout = -1;
  let publishedErrors = '{}';
  const room: Vec3 = [ROOM.width, ROOM.height, ROOM.depth];
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
    if (!c) counters.set(id, (c = { frames: 0, latencySum: 0, latencyN: 0, packets: 0, errors: 0, lastError: '' }));
    return c;
  };

  const step = (now: number) => {
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
    // Generators run every frame (LFOs stay smooth); routes are smoothed per their time constant.
    const channels = generators.tick(s.generators, runtime.sensorValues, dt, s.params.bpm, (kind, key) => (kind === 'osc' ? inputs.osc : inputs.midi).get(key));
    runtime.channelValues = channels;
    const outs: RouteOutputs = {};
    for (const r of s.routes) {
      const raw = routeOutput(r, channels);
      const prev = runtime.routeOutputs[r.id];
      outs[r.id] = prev === undefined || r.smoothMs <= 0 ? raw : prev + (raw - prev) * (1 - Math.exp((-dt * 1000) / r.smoothMs));
    }
    runtime.routeOutputs = outs;
    const { params, mods, layerMods } = resolveParams(s.params, s.routes, outs, s.manualStrobe);
    runtime.params = params;
    runtime.mods = mods;
    runtime.time += dt;
    runtime.phase += dt * params.speed;
    runtime.beat += (dt * params.bpm) / 60;

    // 0. Layer stack on the GPU: base color of every LED, before spatial fields and gain.
    if (renderer) {
      if (rendererLayout !== runtime.layoutVersion) {
        renderer.setLayout(layout);
        rendererLayout = runtime.layoutVersion;
      }
      const stripIndex = new Map(layout.ranges.map((r, i) => [r.stripId, i]));
      const draws: LayerDraw[] = [];
      for (const l of s.layers) {
        if (!l.enabled) continue;
        const mod = (key: string) => layerMods[layerTarget(l.id, key)] ?? 0;
        const floats: Record<string, number> = {};
        const tints: Record<string, [number, number, number]> = {};
        for (const p of parseParams(l.code)) {
          if (p.kind === 'float') floats[p.name] = clamp((l.params[p.name] ?? p.value) + mod(p.name) * (p.max - p.min), p.min, p.max);
          else tints[p.name] = hexToRgb(l.colors[p.name] ?? p.value);
        }
        let mask: Uint8Array | null = null;
        if (l.mask.length) {
          mask = new Uint8Array(Math.max(1, layout.ranges.length));
          for (const id of l.mask) {
            const i = stripIndex.get(id);
            if (i !== undefined) mask[i] = 255;
          }
        }
        draws.push({ id: l.id, code: l.code, blend: l.blend, opacity: clamp(l.opacity + mod(OPACITY_KEY)), mask, floats, colors: tints });
      }
      renderer.render(
        draws,
        {
          time: runtime.time,
          phase: runtime.phase,
          beat: runtime.beat,
          bpm: params.bpm,
          radius: params.radius,
          hue: params.hueShift,
          origin: params.origin,
          room,
          palette: params.palette,
          fadeSec: params.fadeSec,
        },
        colors,
      );
      const errors: Record<string, string> = {};
      for (const l of s.layers) {
        const e = renderer.errors.get(l.code);
        if (e) errors[l.id] = e;
      }
      const key = JSON.stringify(errors);
      if (key !== publishedErrors) {
        publishedErrors = key;
        store.setState({ shaderErrors: errors });
      }
    } else {
      colors.fill(0);
    }

    const strobe = params.strobe ? strobeLevel(runtime.time) : -1;
    const gain = params.masterBrightness;
    const pos = layout.positions;

    // Spatial fields: routes to local_* targets, centered on their source sensor.
    const fields: SpatialField[] = [];
    for (const r of s.routes) {
      if (!r.enabled || !isSpatialTarget(r.target)) continue;
      const sensor = s.sensors.find((x) => x.id === sensorIdOf(r.source));
      if (!sensor || !sensor.enabled) continue;
      const v = outs[r.id] ?? 0;
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
        if (!r.visible || s.blackout || layout.dark[i]) {
          colors[k] = colors[k + 1] = colors[k + 2] = 0;
        } else if (s.scan.active) {
          const v = grayBit(i, s.scan.bit) ? 1 : 0;
          colors[k] = colors[k + 1] = colors[k + 2] = v;
        } else if (strobe >= 0) {
          colors[k] = colors[k + 1] = colors[k + 2] = strobe * gain;
        } else {
          const x = pos[k],
            y = pos[k + 1],
            z = pos[k + 2];
          let mul = 1;
          let add = 0;
          for (const f of fields) {
            const dx = x - f.x,
              dy = y - f.y,
              dz = z - f.z;
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

    // 1b. Per-segment gain, installation test patterns and segment identify. Blackout and
    // skipped LEDs always stay dark; test patterns also light hidden segments.
    const blink = Math.floor(now / 160) % 2 === 0;
    const identifyId = s.identify && now < s.identify.until ? s.identify.stripId : null;
    const chaseHead = Math.floor(runtime.time * 30);
    for (const r of layout.ranges) {
      const pattern = s.testPatterns[r.deviceId] ?? 'off';
      const ident = identifyId === r.stripId;
      if (r.gain === 1 && pattern === 'off' && !ident) continue;
      for (let i = r.start, e = r.start + r.count; i < e; i++) {
        if (s.blackout || layout.dark[i]) continue;
        const k = i * 3;
        let rr: number, gg: number, bb: number;
        if (ident) {
          rr = gg = bb = blink ? 1 : 0;
        } else if (pattern === 'off') {
          colors[k] *= r.gain;
          colors[k + 1] *= r.gain;
          colors[k + 2] *= r.gain;
          continue;
        } else if (pattern === 'identify') {
          rr = 0;
          gg = bb = blink ? 0.8 : 0;
        } else if (pattern === 'chase') {
          const behind = (((chaseHead - (i - r.start)) % r.count) + r.count) % r.count;
          rr = gg = bb = behind === 0 ? 1 : behind < 6 ? 0.25 : 0.02;
        } else {
          rr = pattern === 'white' || pattern === 'red' ? 1 : 0;
          gg = pattern === 'white' || pattern === 'green' ? 1 : 0;
          bb = pattern === 'white' || pattern === 'blue' ? 1 : 0;
        }
        colors[k] = rr;
        colors[k + 1] = gg;
        colors[k + 2] = bb;
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
    // Small tolerance so a clock tick arriving a few ms early does not skip a whole frame.
    if (now - lastSend >= 1000 / DDP_SEND_HZ - 4) {
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
          const [c0, c1, c2] = COLOR_ORDER_INDEX[r.colorOrder];
          for (let k = r.start * 3, e = (r.start + r.count) * 3; k < e; k += 3) {
            rgb[o++] = Math.round(colors[k + c0] * 255);
            rgb[o++] = Math.round(colors[k + c1] * 255);
            rgb[o++] = Math.round(colors[k + c2] * 255);
          }
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
            c.errors++;
            c.lastError = err instanceof Error ? err.message : String(err);
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
          errors: c.errors,
          lastError: c.lastError,
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
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    lastRafAt = now;
    step(now);
  };
  raf = requestAnimationFrame(frame);

  // Sensor tick: every source, simulated or real, goes through the same pipeline.
  const pipeline = new SensorPipeline();
  const sensorDt = 1 / SENSOR_HZ;
  const ticksPerSensor = Math.max(1, Math.round(DDP_SEND_HZ / SENSOR_HZ));
  let sensorT = 0;
  let tick = 0;

  const clockUrl = URL.createObjectURL(new Blob([CLOCK_WORKER_SRC], { type: 'text/javascript' }));
  const clock = new Worker(clockUrl);
  clock.onmessage = () => {
    const now = performance.now();
    if (now - lastRafAt > RAF_STALL_MS) step(now);
    if (++tick % ticksPerSensor !== 0) return;
    sensorT += sensorDt;
    const st = store.getState();
    syncInputs(
      st.sensors.some((x) => x.source === 'osc') || st.generators.some((g) => g.kind === 'osc'),
      st.sensors.some((x) => x.source === 'wled-sync'),
      st.generators.some((g) => g.kind === 'midi'),
    );
    const values = pipeline.tick(st.sensors, sensorT, sensorDt);
    runtime.sensorValues = values;
    store.setState({ sensorValues: { ...runtime.channelValues, ...values } });
  };

  // Reachability: probe each WLED controller's HTTP port, one request in flight per device.
  const probing = new Set<string>();
  const probeAll = () => {
    for (const d of store.getState().devices) {
      if (d.firmware !== 'WLED' || probing.has(d.id)) continue;
      probing.add(d.id);
      const ip = d.ip;
      probeDevice(ip)
        .then((r) => {
          if (store.getState().devices.find((x) => x.id === d.id)?.ip !== ip) return; // IP edited meanwhile
          store.setState((st) => ({ health: { ...st.health, [d.id]: { ...r, checkedAt: Date.now() } } }));
        })
        .catch(() => undefined)
        .finally(() => probing.delete(d.id));
    }
  };
  probeAll();
  const probeTimer = window.setInterval(probeAll, PROBE_INTERVAL_MS);

  return () => {
    cancelAnimationFrame(raf);
    renderer?.dispose();
    clock.terminate();
    URL.revokeObjectURL(clockUrl);
    window.clearInterval(probeTimer);
    pipeline.dispose();
  };
}
