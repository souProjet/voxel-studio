import type { CurveType, EffectParams, Falloff, ModTarget, ModulationRoute, PaletteId, ResolvedParams, ShaderId } from '../types/voxel';
import { PALETTES, ROOM, TARGET_META } from './catalog';

const TAU = Math.PI * 2;

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
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  out[o] = r;
  out[o + 1] = g;
  out[o + 2] = b;
}

/* ------------------------------------------------------------------ */
/* Palettes                                                            */
/* ------------------------------------------------------------------ */

const LUT_SIZE = 256;

/** 256-entry RGB lookup per gradient palette, built once. */
const PALETTE_LUT = Object.fromEntries(
  Object.entries(PALETTES).map(([id, { stops }]) => {
    const lut = new Float32Array(LUT_SIZE * 3);
    const rgb = stops.map(([, hex]) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255));
    for (let i = 0; i < LUT_SIZE && stops.length > 1; i++) {
      const t = i / LUT_SIZE;
      let k = 0;
      while (k < stops.length - 2 && stops[k + 1][0] <= t) k++;
      const f = (t - stops[k][0]) / (stops[k + 1][0] - stops[k][0] || 1);
      for (let c = 0; c < 3; c++) lut[i * 3 + c] = rgb[k][c] + (rgb[k + 1][c] - rgb[k][c]) * f;
    }
    return [id, lut];
  }),
) as Record<PaletteId, Float32Array>;

/** Palette color at position h (wraps), desaturated toward white by s, scaled by v. */
export function colorInto(out: Float32Array | number[], o: number, h: number, s: number, v: number, palette: PaletteId): void {
  if (palette === 'spectrum') return hsvInto(out, o, h, s, v);
  const lut = PALETTE_LUT[palette];
  const i = Math.floor(fract(h) * LUT_SIZE) * 3;
  const w = 1 - s;
  out[o] = (lut[i] * s + w) * v;
  out[o + 1] = (lut[i + 1] * s + w) * v;
  out[o + 2] = (lut[i + 2] * s + w) * v;
}

/* ------------------------------------------------------------------ */
/* Volumetric shaders: f(x, y, z, t, params) -> RGB in 0..1            */
/* `t` is the speed-integrated phase, so speed changes never jump.     */
/* ------------------------------------------------------------------ */

function sphericalWave(out: Float32Array | number[], o: number, x: number, y: number, z: number, t: number, p: ResolvedParams) {
  const dx = x - p.origin[0];
  const dy = y - p.origin[1];
  const dz = z - p.origin[2];
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const r = Math.max(p.radius, 0.05);
  const shellW = 0.12;
  const shell = Math.exp(-((d - r) * (d - r)) / (2 * shellW * shellW));
  const ripple = Math.pow(0.5 + 0.5 * Math.cos(d * 5 - t * 4), 4) * Math.exp((-d / r) * 0.6);
  const v = clamp(shell + ripple * 0.55);
  colorInto(out, o, 0.52 + p.hueShift + d * 0.08, clamp(0.9 - shell * 0.55), v, p.palette);
}

function perlinPlasma(out: Float32Array | number[], o: number, x: number, y: number, z: number, t: number, p: ResolvedParams) {
  const dx = x - p.origin[0];
  const dy = y - p.origin[1];
  const dz = z - p.origin[2];
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const a =
    Math.sin(x * 1.7 + t * 0.9) +
    Math.sin(y * 2.3 - t * 1.1) +
    Math.sin(z * 1.9 + t * 0.7) +
    Math.sin((x + z) * 1.1 + y * 1.5 + t * 0.5) +
    Math.sin(d * (6 / Math.max(p.radius, 0.2)) - t * 1.3);
  const n = a / 5;
  const v = 0.2 + 0.8 * Math.pow(0.5 + 0.5 * Math.sin(n * TAU), 1.5);
  colorInto(out, o, p.hueShift + n * 0.35 + t * 0.02, 0.85, v, p.palette);
}

function laserPlane(out: Float32Array | number[], o: number, x: number, _y: number, _z: number, t: number, p: ResolvedParams) {
  const sweep = Math.sin(t * 0.8);
  const px = p.origin[0] + sweep * (ROOM.width / 2);
  const dir = Math.cos(t * 0.8) >= 0 ? 1 : -1;
  const w = 0.05 + p.radius * 0.04;
  const d = x - px;
  const core = Math.exp(-(d * d) / (2 * w * w));
  const trail = d * dir < 0 ? Math.exp(-Math.abs(d) / 0.6) * 0.3 : 0;
  const v = clamp(core + trail);
  colorInto(out, o, 0.52 + p.hueShift, clamp(0.95 - core * 0.8), v, p.palette);
}

function heightSpectrum(out: Float32Array | number[], o: number, _x: number, y: number, _z: number, t: number, p: ResolvedParams) {
  const yn = clamp(y / ROOM.height);
  const band = 0.5 + 0.5 * Math.sin(y * 7 - t * 2.5);
  colorInto(out, o, p.hueShift + yn * 0.75 + t * 0.03, 0.9, 0.35 + 0.65 * band * band, p.palette);
}

const SHADERS: Record<ShaderId, typeof sphericalWave> = {
  spherical_wave: sphericalWave,
  perlin_plasma: perlinPlasma,
  laser_plane: laserPlane,
  height_spectrum: heightSpectrum,
};

/** Hot-path variant: writes RGB (0..1) into out[o..o+2] without allocating. */
export function shadeInto(
  out: Float32Array | number[],
  o: number,
  shader: ShaderId,
  x: number,
  y: number,
  z: number,
  t: number,
  params: ResolvedParams,
): void {
  SHADERS[shader](out, o, x, y, z, t, params);
}

/** Pure functional form: f(x, y, z, t, params) -> [R, G, B]. */
export function evaluateVoxel(shader: ShaderId, x: number, y: number, z: number, t: number, params: ResolvedParams): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  SHADERS[shader](out, 0, x, y, z, t, params);
  return out;
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

export function routeOutput(route: ModulationRoute, values: ChannelValues): number {
  if (!route.enabled) return 0;
  return shapeRouteInput(route, clamp(values[route.source] ?? 0)) * route.amount;
}

export type ModSums = Record<ModTarget, number>;

export function resolveParams(
  base: EffectParams,
  routes: ModulationRoute[],
  values: ChannelValues,
  manualStrobe: boolean,
): { params: ResolvedParams; mods: ModSums } {
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
  // Spatial targets are summed for display only; the engine evaluates them per LED.
  for (const r of routes) mods[r.target] += routeOutput(r, values);

  const params: ResolvedParams = {
    ...base,
    origin: [base.origin[0], base.origin[1] + mods.origin_y * TARGET_META.origin_y.range, base.origin[2]],
    radius: clamp(base.radius + mods.sphere_radius * TARGET_META.sphere_radius.range, 0.05, 8),
    speed: Math.max(0, base.speed + mods.shader_speed * TARGET_META.shader_speed.range) * (base.bpmSync ? base.bpm / 120 : 1),
    hueShift: fract(base.hueShift + mods.color_shift * TARGET_META.color_shift.range),
    masterBrightness: clamp(base.masterBrightness + mods.master_brightness * TARGET_META.master_brightness.range),
    strobe: manualStrobe || mods.strobe_override > 0.5,
  };
  return { params, mods };
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
