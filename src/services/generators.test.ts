import { describe, expect, it } from 'vitest';
import { GeneratorBank, normalizeGenerator } from './generators';

const run = (bank: GeneratorBank, gens: Parameters<GeneratorBank['tick']>[0], seconds: number, values = {}, bpm = 120, dt = 0.01) => {
  let out = {} as Record<string, number>;
  for (let t = 0; t < seconds - 1e-9; t += dt) out = bank.tick(gens, values, dt, bpm, () => undefined);
  return out;
};

describe('generators', () => {
  it('LFO sine starts low and peaks at half a cycle', () => {
    const g = normalizeGenerator({ id: 'l', name: 'L', kind: 'lfo', rateHz: 1 });
    const bank = new GeneratorBank();
    expect(run(bank, [g], 0.5)['l.out']).toBeCloseTo(1, 1);
    expect(run(bank, [g], 0.5)['l.out']).toBeCloseTo(0, 1);
  });

  it('tempo-locked LFO follows the BPM', () => {
    const g = normalizeGenerator({ id: 'l', name: 'L', kind: 'lfo', shape: 'saw', tempoSync: true, beats: 1 });
    // 120 BPM, one cycle per beat = 0.5 s: after 0.25 s the saw is halfway.
    expect(run(new GeneratorBank(), [g], 0.25)['l.out']).toBeCloseTo(0.5, 1);
  });

  it('envelope runs attack, decay to sustain, then release', () => {
    const g = normalizeGenerator({ id: 'e', name: 'E', kind: 'envelope', trigger: 's.x', attackMs: 100, decayMs: 100, sustain: 0.5, releaseMs: 100 });
    const bank = new GeneratorBank();
    expect(run(bank, [g], 0.05, { 's.x': 1 })['e.out']).toBeCloseTo(0.5, 1);
    expect(run(bank, [g], 0.3, { 's.x': 1 })['e.out']).toBeCloseTo(0.5, 2);
    expect(run(bank, [g], 0.2, { 's.x': 0 })['e.out']).toBe(0);
  });

  it('macro, input mapping and disabled generators', () => {
    const bank = new GeneratorBank();
    const m = normalizeGenerator({ id: 'm', name: 'M', kind: 'macro', value: 0.3 });
    const o = normalizeGenerator({ id: 'o', name: 'O', kind: 'osc', address: '/f', min: 0, max: 200 });
    const off = normalizeGenerator({ id: 'x', name: 'X', kind: 'macro', value: 1, enabled: false });
    const out = bank.tick([m, o, off], {}, 0.01, 120, (kind, key) => (kind === 'osc' && key === '/f' ? 50 : undefined));
    expect(out['m.out']).toBe(0.3);
    expect(out['o.out']).toBeCloseTo(0.25);
    expect(out['x.out']).toBe(0);
  });
});
