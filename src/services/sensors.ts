import type { ChannelKey, SensorChannel, SensorKind, SensorNode, SensorSourceId, SimScenario } from '../types/voxel';
import { inputs, OSC_PORT } from './inputs';

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

/* ------------------------------------------------------------------ */
/* Real sources                                                        */
/* ------------------------------------------------------------------ */

/** Live status line per sensor id, shown in the inspector (permission errors, waiting, live). */
export const sourceStatus = new Map<string, { text: string; ok: boolean }>();

/** Lower and upper edge of shared spectrum bin i (geometric midpoints between bin centers). */
const binEdges = (i: number): [number, number] => [binFrequency(i - 0.5), binFrequency(i + 0.5)];

const micSource: SensorSource = {
  id: 'mic',
  label: 'Microphone',
  description: 'Default audio input of this computer, analyzed with a 4096-point FFT. The system asks for permission the first time.',
  kinds: ['audio'],
  open(getSensor) {
    const id = getSensor().id;
    const spectrum = new Float32Array(SPECTRUM_BINS);
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let stream: MediaStream | null = null;
    let data = new Uint8Array(0);
    let disposed = false;
    sourceStatus.set(id, { text: 'Requesting microphone access…', ok: false });
    if (!navigator.mediaDevices?.getUserMedia) {
      sourceStatus.set(id, { text: 'No audio capture API in this webview.', ok: false });
    } else {
      navigator.mediaDevices
        .getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
        .then((s) => {
          if (disposed) return s.getTracks().forEach((t) => t.stop());
          stream = s;
          ctx = new AudioContext();
          void ctx.resume();
          analyser = ctx.createAnalyser();
          analyser.fftSize = 4096;
          analyser.smoothingTimeConstant = 0; // band envelopes smooth downstream
          analyser.minDecibels = -90;
          analyser.maxDecibels = -20;
          ctx.createMediaStreamSource(s).connect(analyser);
          data = new Uint8Array(analyser.frequencyBinCount);
          sourceStatus.set(id, { text: `Live: ${s.getAudioTracks()[0]?.label || 'default input'}`, ok: true });
        })
        .catch((e: unknown) => {
          if (!disposed) sourceStatus.set(id, { text: `Microphone unavailable: ${e instanceof Error ? e.message : String(e)}`, ok: false });
        });
    }
    return {
      read() {
        if (!analyser || !ctx) return { spectrum: spectrum.fill(0) };
        analyser.getByteFrequencyData(data);
        const hzPerBin = ctx.sampleRate / analyser.fftSize;
        for (let i = 0; i < SPECTRUM_BINS; i++) {
          const [lo, hi] = binEdges(i);
          const a = Math.max(1, Math.floor(lo / hzPerBin));
          const b = Math.min(data.length - 1, Math.max(a, Math.ceil(hi / hzPerBin)));
          let peak = 0;
          for (let k = a; k <= b; k++) if (data[k] > peak) peak = data[k];
          spectrum[i] = peak / 255;
        }
        return { spectrum };
      },
      dispose() {
        disposed = true;
        stream?.getTracks().forEach((t) => t.stop());
        void (ctx as AudioContext | null)?.close();
        sourceStatus.delete(id);
      },
    };
  },
};

/** WLED GEQ channel ranges in Hz (audio_reactive.cpp, 22050 Hz mapping). */
const WLED_GEQ_HZ: [number, number][] = [
  [43, 86], [86, 129], [129, 216], [216, 301], [301, 430], [430, 560], [560, 818], [818, 1120],
  [1120, 1421], [1421, 1895], [1895, 2412], [2412, 3015], [3015, 3704], [3704, 4479], [4479, 7106], [7106, 9259],
];
const WLED_BAND_OF_BIN = BIN_HZ.map((hz) => (hz < 43 ? 0 : WLED_GEQ_HZ.findIndex(([lo, hi]) => hz >= lo && hz < hi)));

const wledSyncSource: SensorSource = {
  id: 'wled-sync',
  label: 'WLED audio sync',
  description: 'Spectrum sent by a WLED controller with a microphone (Sound Reactive, Sync: Send). Multicast 239.0.0.1:11988, sync format v2.',
  kinds: ['audio'],
  open(getSensor) {
    const id = getSensor().id;
    const spectrum = new Float32Array(SPECTRUM_BINS);
    return {
      read() {
        const w = inputs.wled;
        const err = inputs.status.wledError;
        if (!w || w.ageMs > 1000) {
          sourceStatus.set(id, { text: err ?? 'Waiting for WLED audio sync packets on 239.0.0.1:11988…', ok: false });
          return { spectrum: spectrum.fill(0) };
        }
        sourceStatus.set(id, { text: `Live: ${w.ageMs} ms old`, ok: true });
        for (let i = 0; i < SPECTRUM_BINS; i++) {
          const band = WLED_BAND_OF_BIN[i];
          spectrum[i] = band < 0 ? 0 : w.fft[band] / 255;
        }
        return { spectrum };
      },
      dispose() {
        sourceStatus.delete(id);
      },
    };
  },
};

/** OSC address of a sensor channel: /voxel/<sensor id>/<channel id>. */
export const oscAddressOf = (sensorId: string, channelId: string) => `/voxel/${sensorId}/${channelId}`;

const oscSource: SensorSource = {
  id: 'osc',
  label: 'OSC',
  description: `Values in the channel unit, sent over OSC (UDP ${OSC_PORT}) by the sensor's ESP32 or any OSC app, one address per channel.`,
  kinds: ['audio', 'gps', 'gpio', 'gyro'],
  open(getSensor) {
    const id = getSensor().id;
    return {
      read() {
        const s = getSensor();
        const values: Record<string, number> = {};
        let any = false;
        for (const c of sensorChannels(s)) {
          const v = inputs.osc.get(oscAddressOf(s.id, c.channelId));
          if (v !== undefined) {
            values[c.channelId] = v;
            any = true;
          }
        }
        const err = inputs.status.oscError;
        sourceStatus.set(id, err ? { text: err, ok: false } : any ? { text: `Receiving on UDP ${OSC_PORT}`, ok: true } : { text: `Listening on UDP ${OSC_PORT}, nothing received yet`, ok: false });
        return { values };
      },
      dispose() {
        sourceStatus.delete(id);
      },
    };
  },
};

/** Source registry. Register new hardware sources here. */
export const SENSOR_SOURCES: Record<SensorSourceId, SensorSource> = {
  sim: simulatorSource,
  mic: micSource,
  'wled-sync': wledSyncSource,
  osc: oscSource,
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
