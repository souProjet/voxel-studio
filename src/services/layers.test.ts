import { describe, expect, it } from 'vitest';
import type { EffectLayer } from '../types/voxel';
import { formatGlslError } from './layerRenderer';
import { layerInputs, makeLayer, OPACITY_KEY, parseLayerTarget, parseParams, PRELUDE_LINES, PRESETS, resolveTarget } from './layers';

const layer = (code: string): EffectLayer => ({ ...makeLayer('L1', 'solid', 'Test'), code });

describe('layer shader parameters', () => {
  it('reads float defaults and ranges, and colors', () => {
    const params = parseParams(`uniform float speed; // 2 [0, 4]
uniform float bare;
  uniform vec3 tint; // #FF8800
uniform float clamped; // 9 [0, 1]
// uniform float commented;
`);
    expect(params).toEqual([
      { kind: 'float', name: 'speed', value: 2, min: 0, max: 4 },
      { kind: 'float', name: 'bare', value: 0.5, min: 0, max: 1 },
      { kind: 'color', name: 'tint', value: '#ff8800' },
      { kind: 'float', name: 'clamped', value: 1, min: 0, max: 1 },
    ]);
  });

  it('every preset defines shade() and parses', () => {
    for (const p of PRESETS) {
      expect(p.code).toMatch(/vec3 shade\(vec3 p\)/);
      expect(() => parseParams(p.code)).not.toThrow();
    }
  });
});

describe('layer route targets', () => {
  const l = layer('uniform float density; // 0.2 [0, 1]\nvec3 shade(vec3 p) { return vec3(density); }');

  it('splits layer targets and leaves scene targets alone', () => {
    expect(parseLayerTarget('layer:L1:density')).toEqual({ layerId: 'L1', key: 'density' });
    expect(parseLayerTarget('sphere_radius')).toBeNull();
  });

  it('lists opacity then float parameters as inputs', () => {
    expect(layerInputs(l).map((x) => x.target)).toEqual([`layer:L1:${OPACITY_KEY}`, 'layer:L1:density']);
  });

  it('resolves ranges, and null once the layer or parameter is gone', () => {
    expect(resolveTarget('layer:L1:density', [l])?.range).toBe(1);
    expect(resolveTarget(`layer:L1:${OPACITY_KEY}`, [l])?.unit).toBe('%');
    expect(resolveTarget('layer:L1:missing', [l])).toBeNull();
    expect(resolveTarget('layer:L2:density', [l])).toBeNull();
    expect(resolveTarget('sphere_radius', [])?.range).toBe(2);
  });
});

describe('GLSL errors', () => {
  it('reports lines relative to the user code', () => {
    const log = `ERROR: 0:${PRELUDE_LINES + 12}: 'oops' : syntax error\nERROR: 1 compilation errors.`;
    expect(formatGlslError(log)).toBe("line 12: 'oops' : syntax error\nERROR: 1 compilation errors.");
  });
});
