import type { ChannelKey, Generator, GeneratorKind, LfoShape, ModulationRoute, SensorChannel, SensorNode } from '../types/voxel';
import { allChannels } from './sensors';
import type { ChannelValues } from './shaderMath';

export const GENERATOR_META: Record<GeneratorKind, { label: string; color: string; description: string }> = {
  lfo: { label: 'LFO', color: '#38BDF8', description: 'Periodic wave, free-running in Hz or locked to the effect tempo.' },
  envelope: { label: 'Envelope', color: '#FB7185', description: 'ADSR triggered when a channel rises above a threshold.' },
  macro: { label: 'Macro', color: '#A3E635', description: 'Manual knob, also on the Live Pad. Patch it to several routes at once.' },
  osc: { label: 'OSC In', color: '#FBBF24', description: 'Value received over OSC (UDP) at an address; use Learn to capture it.' },
  midi: { label: 'MIDI In', color: '#C084FC', description: 'Knob, fader, pad or pitch bend from any connected MIDI port; use Learn to capture it.' },
};

export const LFO_SHAPES: LfoShape[] = ['sine', 'triangle', 'saw', 'square', 'random'];

const DEFAULTS: Omit<Generator, 'id' | 'name' | 'kind'> = {
  enabled: true,
  shape: 'sine',
  rateHz: 0.5,
  tempoSync: false,
  beats: 4,
  phase: 0,
  trigger: null,
  threshold: 0.5,
  attackMs: 20,
  decayMs: 200,
  sustain: 0.6,
  releaseMs: 600,
  value: 0,
  address: '',
  min: 0,
  max: 1,
};

export function normalizeGenerator(g: Pick<Generator, 'id' | 'name' | 'kind'> & Partial<Generator>): Generator {
  return { ...DEFAULTS, ...g };
}

export const ROUTE_DEFAULTS: Pick<ModulationRoute, 'inMin' | 'inMax' | 'smoothMs' | 'amountSource'> = {
  inMin: 0,
  inMax: 1,
  smoothMs: 0,
  amountSource: null,
};

export function generatorChannel(g: Generator): SensorChannel {
  return { key: `${g.id}.out`, sensorId: g.id, channelId: 'out', label: g.name, unit: '', min: 0, max: 1 };
}

/** Every channel a route can read: sensor channels, then generator outputs. */
export const modChannels = (sensors: SensorNode[], generators: Generator[]): SensorChannel[] => [...allChannels(sensors), ...generators.map(generatorChannel)];

const fract = (v: number) => v - Math.floor(v);

function lfoValue(shape: LfoShape, p: number, held: number): number {
  switch (shape) {
    case 'sine':
      return 0.5 - 0.5 * Math.cos(p * Math.PI * 2);
    case 'triangle':
      return p < 0.5 ? p * 2 : 2 - p * 2;
    case 'saw':
      return p;
    case 'square':
      return p < 0.5 ? 1 : 0;
    case 'random':
      return held;
  }
}

/** Latest raw value received for an OSC address or a MIDI key. */
export type InputLookup = (kind: 'osc' | 'midi', key: string) => number | undefined;

interface GenState {
  phase: number;
  held: number;
  level: number;
  stage: 'idle' | 'attack' | 'decay' | 'sustain' | 'release';
  gate: boolean;
  last: number;
}

/**
 * Evaluates generators once per frame. Generators may read sensor channels and the outputs
 * of generators listed before them (later ones are seen one frame late).
 */
export class GeneratorBank {
  private state = new Map<string, GenState>();

  tick(generators: Generator[], values: ChannelValues, dt: number, bpm: number, input: InputLookup): ChannelValues {
    const out: ChannelValues = { ...values };
    const seen = new Set<string>();
    for (const g of generators) {
      seen.add(g.id);
      let st = this.state.get(g.id);
      if (!st) this.state.set(g.id, (st = { phase: 0, held: Math.random(), level: 0, stage: 'idle', gate: false, last: 0 }));
      out[`${g.id}.out`] = g.enabled ? this.evaluate(g, st, out, dt, bpm, input) : 0;
    }
    for (const id of this.state.keys()) if (!seen.has(id)) this.state.delete(id);
    return out;
  }

  private evaluate(g: Generator, st: GenState, values: ChannelValues, dt: number, bpm: number, input: InputLookup): number {
    switch (g.kind) {
      case 'lfo': {
        const hz = g.tempoSync ? bpm / 60 / Math.max(g.beats, 1 / 16) : g.rateHz;
        const before = st.phase;
        st.phase = fract(st.phase + dt * hz);
        if (st.phase < before) st.held = Math.random();
        return lfoValue(g.shape, fract(st.phase + g.phase), st.held);
      }
      case 'envelope': {
        const gate = g.trigger ? (values[g.trigger as ChannelKey] ?? 0) > g.threshold : false;
        if (gate && !st.gate) st.stage = 'attack';
        if (!gate && st.gate && st.stage !== 'idle') st.stage = 'release';
        st.gate = gate;
        const ms = dt * 1000;
        switch (st.stage) {
          case 'attack':
            st.level += ms / Math.max(g.attackMs, 1);
            if (st.level >= 1) {
              st.level = 1;
              st.stage = 'decay';
            }
            break;
          case 'decay':
            st.level -= ((1 - g.sustain) * ms) / Math.max(g.decayMs, 1);
            if (st.level <= g.sustain) {
              st.level = g.sustain;
              st.stage = 'sustain';
            }
            break;
          case 'release':
            st.level -= ms / Math.max(g.releaseMs, 1);
            if (st.level <= 0) {
              st.level = 0;
              st.stage = 'idle';
            }
            break;
          default:
            break;
        }
        return Math.max(0, Math.min(1, st.level));
      }
      case 'macro':
        return Math.max(0, Math.min(1, g.value));
      case 'osc':
      case 'midi': {
        const raw = input(g.kind, g.address);
        if (raw !== undefined && g.max !== g.min) st.last = Math.max(0, Math.min(1, (raw - g.min) / (g.max - g.min)));
        return st.last;
      }
    }
  }
}
