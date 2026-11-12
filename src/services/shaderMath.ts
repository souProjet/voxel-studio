import type { CurveType, EffectParams, Falloff, ModTarget, ModulationRoute, PaletteId, ResolvedParams } from '../types/voxel';
import { PALETTES, TARGET_META } from './catalog';

export const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
const fract = (v: number) => v - Math.floor(v);

/** HSV (all 0..1) to RGB written into out[o..o+2]. */
export function hsvInto(out: Float32Array | number[], o: number, h: number, s: number, v: number): void {
  const hh = fract(h) * 6;
  const i = Math.floor(hh);
  const f = hh - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  let r: number, g: number, b: number;
  switch (i) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    default:
      r = v;
      g = p;
      b = q;
      break;
  }
  out[o] = r;
  out[o + 1] = g;
  out[o + 2] = b;
}

/* ------------------------------------------------------------------ */
/* Palettes                                                            */
/* ------------------------------------------------------------------ */

const LUT_SIZE = 256;
const luts = new Map<PaletteId, Float32Array>();

/** 256-entry RGB lookup of a palette (built once), sampled by the layer shaders' palette(). */
export function paletteLut(id: PaletteId): Float32Array {
  const hit = luts.get(id);
  if (hit) return hit;
  const lut = new Float32Array(LUT_SIZE * 3);
  const stops = PALETTES[id].stops;
  if (stops.length < 2) {
    for (let i = 0; i < LUT_SIZE; i++) hsvInto(lut, i * 3, i / LUT_SIZE, 1, 1);
  } else {
    const rgb = stops.map(([, hex]) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255));
    for (let i = 0; i < LUT_SIZE; i++) {
      const t = i / LUT_SIZE;
      let k = 0;
      while (k < stops.length - 2 && stops[k + 1][0] <= t) k++;
      const f = (t - stops[k][0]) / (stops[k + 1][0] - stops[k][0] || 1);
      for (let c = 0; c < 3; c++) lut[i * 3 + c] = rgb[k][c] + (rgb[k + 1][c] - rgb[k][c]) * f;
    }
  }
  luts.set(id, lut);
  return lut;
}

/* ------------------------------------------------------------------ */
/* Modulation                                                          */
/* ------------------------------------------------------------------ */

/** Unipolar response curve, x in 0..1 -> 0..1. */
export function curveValue(curve: CurveType, x: number): number {
  const v = clamp(x);
  switch (curve) {
    case 'linear':
      return v;
    case 'exp':
      return (Math.exp(4 * v) - 1) / (Math.exp(4) - 1);
    case 'scurve':
      return v * v * (3 - 2 * v);
    case 'step':
      return v >= 0.5 ? 1 : 0;
  }
}

/** Signed curve response for a route input (0..1). Bipolar remaps the input to -1..+1 first. */
export function shapeRouteInput(route: Pick<ModulationRoute, 'curve' | 'bipolar'>, normalized: number): number {
  if (!route.bipolar) return curveValue(route.curve, normalized);
  const b = normalized * 2 - 1;
  return Math.sign(b) * curveValue(route.curve, Math.abs(b));
}

/** Normalized channel values (0..1) keyed by channel key. */
export type ChannelValues = Record<string, number>;

/** Maps a normalized source value through the route's input window, curve and amount. */
export function routeTransfer(route: Pick<ModulationRoute, 'curve' | 'bipolar' | 'inMin' | 'inMax' | 'amount'>, x: number): number {
  const w = route.inMax - route.inMin;
  const windowed = w > 1e-6 ? clamp((x - route.inMin) / w) : x >= route.inMin ? 1 : 0;
  return shapeRouteInput(route, windowed) * route.amount;
}

/** Instantaneous route output (before smoothing): transfer times the optional amount modulator. */
export function routeOutput(route: ModulationRoute, values: ChannelValues): number {
  if (!route.enabled) return 0;
  const depth = route.amountSource ? clamp(values[route.amountSource] ?? 0) : 1;
  return routeTransfer(route, clamp(values[route.source] ?? 0)) * depth;
}

/** Route outputs keyed by route id, after smoothing (computed by the engine). */
export type RouteOutputs = Record<string, number>;

export type ModSums = Record<ModTarget, number>;

/** Summed route outputs per layer target (`layer:<id>:<key>`), before scaling to the parameter range. */
export type LayerMods = Record<string, number>;

export function resolveParams(
  base: EffectParams,
  routes: ModulationRoute[],
  outputs: RouteOutputs,
  manualStrobe: boolean,
): { params: ResolvedParams; mods: ModSums; layerMods: LayerMods } {
  const mods: ModSums = {
    sphere_radius: 0,
    shader_speed: 0,
    color_shift: 0,
    strobe_override: 0,
    master_brightness: 0,
    origin_y: 0,
    local_intensity: 0,
    local_wave: 0,
  };
  const layerMods: LayerMods = {};
  // Spatial targets are summed for display only; the engine evaluates them per LED.
  for (const r of routes) {
    const v = outputs[r.id] ?? 0;
    if (r.target in mods) mods[r.target as ModTarget] += v;
    else layerMods[r.target] = (layerMods[r.target] ?? 0) + v;
  }

  const params: ResolvedParams = {
    ...base,
    origin: [base.origin[0], base.origin[1] + mods.origin_y * TARGET_META.origin_y.range, base.origin[2]],
    radius: clamp(base.radius + mods.sphere_radius * TARGET_META.sphere_radius.range, 0.05, 8),
    speed: Math.max(0, base.speed + mods.shader_speed * TARGET_META.shader_speed.range) * (base.bpmSync ? base.bpm / 120 : 1),
    hueShift: fract(base.hueShift + mods.color_shift * TARGET_META.color_shift.range),
    masterBrightness: clamp(base.masterBrightness + mods.master_brightness * TARGET_META.master_brightness.range),
    strobe: manualStrobe || mods.strobe_override > 0.5,
  };
  return { params, mods, layerMods };
}

/** Spatial weight of a sensor at distance d, 1 at the sensor, 0 beyond `radius`. */
export function falloffWeight(falloff: Falloff, d: number, radius: number): number {
  const x = d / Math.max(radius, 0.01);
  if (x >= 1) return 0;
  switch (falloff) {
    case 'linear':
      return 1 - x;
    case 'smooth': {
      const k = 1 - x * x;
      return k * k;
    }
    case 'gaussian':
      return Math.exp(-(x * x) * 4.5);
  }
}

/** 12.5 Hz white strobe, 40 % duty. */
export function strobeLevel(timeSec: number): number {
  return fract(timeSec * 12.5) < 0.4 ? 1 : 0;
}

/** Reflected binary Gray code of an LED index, bit k (0 = LSB). */
export function grayBit(index: number, bit: number): boolean {
  const gray = index ^ (index >> 1);
  return ((gray >> bit) & 1) === 1;
}

export function grayDecode(gray: number): number {
  let n = gray;
  for (let shift = gray >> 1; shift; shift >>= 1) n ^= shift;
  return n;
}
