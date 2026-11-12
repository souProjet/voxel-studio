import { describe, expect, it } from 'vitest';
import type { EffectParams, ModulationRoute } from '../types/voxel';
import { EFFECT_DEFAULTS } from './catalog';
import { ROUTE_DEFAULTS } from './generators';
import { colorInto, curveValue, falloffWeight, grayBit, grayDecode, resolveParams, routeOutput, routeTransfer, shapeRouteInput } from './shaderMath';

const route = (p: Partial<ModulationRoute> = {}): ModulationRoute => ({
  id: 'r',
  source: 's.a',
  target: 'sphere_radius',
  curve: 'linear',
  amount: 1,
  bipolar: false,
  enabled: true,
  ...ROUTE_DEFAULTS,
  ...p,
});

const base: EffectParams = { origin: [0, 1, 0], radius: 1, speed: 1, hueShift: 0, masterBrightness: 0.5, ...EFFECT_DEFAULTS };

describe('modulation math', () => {
  it('curves map 0 to 0 and 1 to 1', () => {
    for (const c of ['linear', 'exp', 'scurve', 'step'] as const) {
      expect(curveValue(c, 0)).toBeCloseTo(0);
      expect(curveValue(c, 1)).toBeCloseTo(1);
    }
    expect(curveValue('scurve', 0.5)).toBeCloseTo(0.5);
    expect(curveValue('step', 0.49)).toBe(0);
  });

  it('bipolar input is signed around the midpoint', () => {
    expect(shapeRouteInput({ curve: 'linear', bipolar: true }, 0)).toBeCloseTo(-1);
    expect(shapeRouteInput({ curve: 'linear', bipolar: true }, 0.5)).toBeCloseTo(0);
  });

  it('input window rescales the source', () => {
    const r = route({ inMin: 0.2, inMax: 0.6 });
    expect(routeTransfer(r, 0.1)).toBe(0);
    expect(routeTransfer(r, 0.4)).toBeCloseTo(0.5);
    expect(routeTransfer(r, 0.9)).toBe(1);
  });

  it('amount source scales the output and disabled routes are silent', () => {
    const values = { 's.a': 1, 'm.out': 0.25 };
    expect(routeOutput(route({ amountSource: 'm.out' }), values)).toBeCloseTo(0.25);
    expect(routeOutput(route({ enabled: false }), values)).toBe(0);
  });

  it('resolves params from route outputs with clamping and tempo sync', () => {
    const r1 = route({ id: 'a', target: 'master_brightness' });
    const r2 = route({ id: 'b', target: 'shader_speed' });
    const { params, mods } = resolveParams({ ...base, bpm: 60, bpmSync: true }, [r1, r2], { a: 2, b: 0 }, false);
    expect(mods.master_brightness).toBe(2);
    expect(params.masterBrightness).toBe(1);
    expect(params.speed).toBeCloseTo(0.5); // 60 BPM = 0.5x
    expect(params.palette).toBe('spectrum');
  });
});

describe('color and helpers', () => {
  it('palettes differ from the spectrum and respect value', () => {
    const a = [0, 0, 0],
      b = [0, 0, 0],
      c = [0, 0, 0];
    colorInto(a, 0, 0.6, 1, 1, 'spectrum');
    colorInto(b, 0, 0.6, 1, 1, 'fire');
    colorInto(c, 0, 0.6, 1, 0, 'fire');
    expect(b).not.toEqual(a);
    expect(b[0]).toBeGreaterThan(b[2]); // fire is warm
    expect(c).toEqual([0, 0, 0]);
  });

  it('Gray code decodes back to the index', () => {
    for (let i = 0; i < 1024; i++) {
      let g = 0;
      for (let bit = 0; bit < 11; bit++) if (grayBit(i, bit)) g |= 1 << bit;
      expect(grayDecode(g)).toBe(i);
    }
  });

  it('falloff is 1 at the sensor and 0 at the radius', () => {
    for (const f of ['linear', 'smooth', 'gaussian'] as const) {
      expect(falloffWeight(f, 0, 2)).toBeCloseTo(1);
      expect(falloffWeight(f, 2, 2)).toBe(0);
    }
  });
});
