import type { ChannelKey, SensorChannel, SensorKind, SensorNode, SensorSourceId, SimScenario } from '../types/voxel';

/* ------------------------------------------------------------------ */
/* Source contract                                                     */
/* ------------------------------------------------------------------ */

/** Shared spectrum format: log-spaced magnitude bins, 0..1. */
export const SPECTRUM_BINS = 48;
export const SPECTRUM_MIN_HZ = 20;
export const SPECTRUM_MAX_HZ = 16000;

export const binFrequency = (i: number) => SPECTRUM_MIN_HZ * Math.pow(SPECTRUM_MAX_HZ / SPECTRUM_MIN_HZ, i / (SPECTRUM_BINS - 1));
const BIN_HZ = Array.from({ length: SPECTRUM_BINS }, (_, i) => binFrequency(i));
const BIN_LOG2 = BIN_HZ.map(Math.log2);

/**
 * What a source hands to the pipeline on every tick.
 * - Audio sources provide `spectrum`; band split, gain and envelopes are applied downstream,
 *   so the same band settings work for any audio source.
 * - Other sources provide raw `values` per channel id, in the channel's unit (km/h, degrees, 0/1).
 *   An audio source may also provide `values` keyed by band id to bypass the band split.
 */
export interface SourceFrame {
  spectrum?: Float32Array;
  values?: Record<string, number>;
}

export interface SensorReader {
  /** Called at the sensor tick rate. Push-based sources return their latest sample. */
  read(timeSec: number, dtSec: number): SourceFrame;
  dispose(): void;
}

/**
 * A pluggable signal source. Adding real hardware means implementing this interface
 * (for example a Web Audio microphone, a WLED audio-sync UDP listener or an OSC listener
 * exposed by the Tauri bridge) and registering it in SENSOR_SOURCES. Sensors, the modulation
 * matrix, spatial routing and the UI consume only channels and need no change.
 */
export interface SensorSource {
  id: SensorSourceId;
  label: string;
  description: string;
  kinds: SensorKind[];
  /** `getSensor` always returns the latest sensor config, so live edits apply without reopening. */
  open(getSensor: () => SensorNode): SensorReader;
}

/* ------------------------------------------------------------------ */
/* Channels                                                            */
/* ------------------------------------------------------------------ */

export const channelKey = (sensorId: string, channelId: string): ChannelKey => `${sensorId}.${channelId}`;
export const sensorIdOf = (key: ChannelKey) => key.slice(0, key.indexOf('.'));

export function sensorChannels(s: SensorNode): SensorChannel[] {
  const ch = (channelId: string, label: string, unit: string, min: number, max: number): SensorChannel => ({
    key: channelKey(s.id, channelId),
    sensorId: s.id,
    channelId,
    label,
    unit,
    min,
    max,
  });
  switch (s.kind) {
    case 'audio':
      return s.bands.map((b) => ch(b.id, b.label, '', 0, 1));
    case 'gps':
      return [ch('speed', 'Speed', 'km/h', 0, 160)];
    case 'gpio':
      return [ch('pressed', 'Pressed', '', 0, 1)];
    case 'gyro':
      return [ch('pitch', 'Pitch', '°', -90, 90)];
  }
}

export const allChannels = (sensors: SensorNode[]) => sensors.flatMap(sensorChannels);

export const denormalize = (c: SensorChannel, v: number) => c.min + v * (c.max - c.min);
export const normalize = (c: SensorChannel, raw: number) => Math.max(0, Math.min(1, (raw - c.min) / (c.max - c.min)));

/** Value used when a manual channel has never been set. */
export const manualDefault = (c: SensorChannel) => (c.min < 0 ? 0 : c.min);

/* ------------------------------------------------------------------ */
/* Simulator source                                                    */
/* ------------------------------------------------------------------ */

const gauss = (i: number, hz: number, widthOct: number) => {
  const d = BIN_LOG2[i] - Math.log2(hz);
  return Math.exp(-(d * d) / (2 * widthOct * widthOct));
};

function makeRandom(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

const BASS_PATTERN = [0, 0, 7, 5];

function synthSpectrum(scenario: SimScenario, bpm: number, t: number, out: Float32Array, rnd: () => number): void {
  const beat = (t * bpm) / 60;
  const ph = beat % 1;
  const off = (ph + 0.5) % 1;
  for (let i = 0; i < SPECTRUM_BINS; i++) {
    let v = 0;
    switch (scenario) {
      case 'electro': {
        const kick = Math.exp(-ph * 9);
        const eighth = Math.floor(beat * 2);
        const noteHz = 55 * Math.pow(2, BASS_PATTERN[eighth % 4] / 12);
        const bassEnv = 0.6 + 0.4 * Math.exp(-((beat * 2) % 1) * 4);
        const snare = Math.floor(beat) % 2 === 1 ? Math.exp(-ph * 12) : 0;
        const hat = Math.exp(-off * 16);
        const pad = 0.12 + 0.06 * Math.sin(t * 0.5);
        v =
          kick * gauss(i, 60, 0.45) +
          kick * 0.15 * gauss(i, 3000, 0.8) +
          0.55 * bassEnv * gauss(i, noteHz, 0.2) +
          snare * (0.5 * gauss(i, 200, 0.4) + 0.35 * gauss(i, 2500, 1.2)) +
          hat * 0.7 * gauss(i, 9000, 0.5) +
          pad * gauss(i, 700, 0.9);
        break;
      }
      case 'ambient':
        v =
          (0.35 + 0.25 * Math.sin(t * 0.3)) * gauss(i, 400, 1) +
          0.25 * (0.5 + 0.5 * Math.sin(t * 0.13)) * gauss(i, 110, 0.3) +
          0.1 * (0.5 + 0.5 * Math.sin(t * 1.7)) * gauss(i, 6000, 0.6);
        break;
      case 'speech': {
        const syllable = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 4.2)), 2) * (Math.sin(t * 0.7) > -0.3 ? 1 : 0);
        const f1 = 500 + 200 * Math.sin(t * 3.1);
        const f2 = 1500 + 400 * Math.sin(t * 2.3);
        v = syllable * (0.6 * gauss(i, f1, 0.25) + 0.45 * gauss(i, f2, 0.25) + 0.2 * gauss(i, 140, 0.2) + 0.15 * gauss(i, 5000, 0.5));
        break;
      }
      default:
        break;
    }
    out[i] = Math.min(1, v + rnd() * 0.02);
  }
}

function cityProfile(t: number): number {
  const c = t % 20;
  if (c < 6) return (c / 6) * 50;
  if (c < 12) return 50 + 3 * Math.sin(c * 2);
  if (c < 16) return 50 * (1 - (c - 12) / 4);
  return 0;
}

const simulatorSource: SensorSource = {
  id: 'sim',
  label: 'Simulator',
  description: 'Synthetic signals generated locally: musical spectra, driving profiles, IMU sway, or manual values.',
  kinds: ['audio', 'gps', 'gpio', 'gyro'],
  open(getSensor) {
    let seed = 0;
    for (const c of getSensor().id) seed = (seed * 31 + c.charCodeAt(0)) | 0;
    const rnd = makeRandom(seed);
    const spectrum = new Float32Array(SPECTRUM_BINS);
    return {
      read(t) {
        const s = getSensor();
        if (s.sim.mode === 'manual' || s.kind === 'gpio') {
          const values: Record<string, number> = {};
          for (const c of sensorChannels(s)) values[c.channelId] = s.sim.manual[c.channelId] ?? manualDefault(c);
          return { values };
        }
        switch (s.kind) {
          case 'audio':
            synthSpectrum(s.sim.scenario, s.sim.bpm, t, spectrum, rnd);
            return { spectrum };
          case 'gps': {
            const kmh = s.sim.scenario === 'city' ? cityProfile(t) : 85 + 35 * Math.sin(t * 0.07) + 8 * Math.sin(t * 0.31);
            return { values: { speed: Math.max(0, kmh + (rnd() - 0.5)) } };
          }
          case 'gyro':
            return { values: { pitch: 18 * Math.sin(t * 0.9) + 4 * Math.sin(t * 2.3) } };
          default:
            return {};
        }
      },
      dispose() {},
    };
  },
};

/** Source registry. Register new hardware sources here. */
export const SENSOR_SOURCES: Record<SensorSourceId, SensorSource> = {
  sim: simulatorSource,
};

/* ------------------------------------------------------------------ */
/* Pipeline: source frames -> normalized channel values               */
/* ------------------------------------------------------------------ */

function bandEnergy(spectrum: Float32Array, lowHz: number, highHz: number): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < SPECTRUM_BINS; i++) {
    if (BIN_HZ[i] >= lowHz && BIN_HZ[i] <= highHz) {
      sum += spectrum[i];
      n++;
    }
  }
  if (n > 0) return sum / n;
  const center = Math.log2(Math.sqrt(Math.max(lowHz, 1) * Math.max(highHz, 1)));
  let best = 0;
  for (let i = 1; i < SPECTRUM_BINS; i++) if (Math.abs(BIN_LOG2[i] - center) < Math.abs(BIN_LOG2[best] - center)) best = i;
  return spectrum[best];
}

export class SensorPipeline {
  private readers = new Map<string, { source: SensorSourceId; reader: SensorReader }>();
  private latest = new Map<string, SensorNode>();
  private env = new Map<ChannelKey, number>();

  tick(sensors: SensorNode[], t: number, dt: number): Record<ChannelKey, number> {
    const out: Record<ChannelKey, number> = {};
    const seen = new Set<string>();
    for (const s of sensors) {
      seen.add(s.id);
      this.latest.set(s.id, s);
      let entry = this.readers.get(s.id);
      if (!entry || entry.source !== s.source) {
        entry?.reader.dispose();
        const id = s.id;
        entry = { source: s.source, reader: SENSOR_SOURCES[s.source].open(() => this.latest.get(id) ?? s) };
        this.readers.set(s.id, entry);
      }
      const channels = sensorChannels(s);
      if (!s.enabled) {
        for (const c of channels) out[c.key] = 0;
        continue;
      }
      const frame = entry.reader.read(t, dt);
      for (const c of channels) {
        const raw = frame.values?.[c.channelId];
        if (raw !== undefined) {
          out[c.key] = normalize(c, raw);
        } else if (frame.spectrum && s.kind === 'audio') {
          const band = s.bands.find((b) => b.id === c.channelId);
          if (!band) continue;
          const target = Math.min(1, bandEnergy(frame.spectrum, band.lowHz, band.highHz) * band.gain);
          const prev = this.env.get(c.key) ?? 0;
          const tauMs = Math.max(1, target > prev ? band.attackMs : band.releaseMs);
          const next = prev + (target - prev) * (1 - Math.exp((-dt * 1000) / tauMs));
          this.env.set(c.key, next);
          out[c.key] = next;
        } else {
          out[c.key] = 0;
        }
      }
    }
    for (const [id, entry] of this.readers) {
      if (seen.has(id)) continue;
      entry.reader.dispose();
      this.readers.delete(id);
      this.latest.delete(id);
    }
    return out;
  }

  dispose(): void {
    for (const entry of this.readers.values()) entry.reader.dispose();
    this.readers.clear();
  }
}
