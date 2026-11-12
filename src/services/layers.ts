import type { BlendMode, EffectLayer, RouteTarget } from '../types/voxel';
import { TARGET_META, type TargetMeta } from './catalog';
import { tk } from '../i18n';

/**
 * Layer shaders are GLSL ES 3.00 snippets defining `vec3 shade(vec3 p)`, run once per LED on the GPU.
 * PRELUDE is prepended: it declares the built-in inputs and helpers listed in SHADER_REFERENCE.
 */
export const PRELUDE = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uPos;
uniform sampler2D uPalette;
uniform sampler2D uMask;
uniform bool uMasked;
uniform int uMode;
uniform float uOpacity;
uniform float TIME;
uniform float PHASE;
uniform float BEAT;
uniform float BPM;
uniform float RADIUS;
uniform float HUE;
uniform vec3 ORIGIN;
uniform vec3 ROOM;
uniform int COUNT;
int INDEX;
float STRIP;
float ALONG;
out vec4 fragColor;
const float PI = 3.14159265;
const float TAU = 6.28318531;
vec3 hsv(float h, float s, float v) {
  vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return v * mix(vec3(1.0), k, s);
}
vec3 palette(float h) { return texture(uPalette, vec2(fract(h + HUE), 0.5)).rgb; }
vec3 palette(float h, float s, float v) { return (palette(h) * s + (1.0 - s)) * v; }
float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
  return s / 0.9375;
}
`;

/** Appended after the user code: fetches the LED, applies the segment mask and the blend mode. */
export const EPILOGUE = `
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  INDEX = px.y * textureSize(uPos, 0).x + px.x;
  if (INDEX >= COUNT) discard;
  vec4 P = texelFetch(uPos, px, 0);
  STRIP = floor(P.w);
  ALONG = fract(P.w);
  if (uMasked && texelFetch(uMask, ivec2(int(STRIP), 0), 0).r < 0.5) discard;
  vec3 c = shade(P.xyz);
  if (any(isnan(c))) c = vec3(0.0);
  c = clamp(c, 0.0, 1.0);
  if (uMode == 4) fragColor = vec4(mix(vec3(1.0), c, uOpacity), 1.0);
  else if (uMode == 0) fragColor = vec4(c, uOpacity);
  else fragColor = vec4(c * uOpacity, 1.0);
}
`;

/** Lines before the user code, to report compiler errors at the user's line numbers. */
export const PRELUDE_LINES = PRELUDE.split('\n').length - 1;

export const BLEND_MODES: BlendMode[] = ['normal', 'add', 'screen', 'max', 'multiply'];
export const BLEND_INDEX: Record<BlendMode, number> = { normal: 0, add: 1, screen: 2, max: 3, multiply: 4 };

/** Built-ins shown in the code editor's reference panel. */
export const SHADER_REFERENCE: [string, string][] = [
  ['vec3 shade(vec3 p)', tk('Your function: LED position in meters, returns RGB 0..1')],
  ['TIME, PHASE', tk('Seconds since start; phase integrates the scene speed')],
  ['BEAT, BPM', tk('Beats elapsed at the scene tempo, and the tempo')],
  ['ORIGIN, RADIUS', tk('Scene origin (vec3) and radius, both modulable')],
  ['ROOM', tk('Room size in meters (width, height, depth)')],
  ['INDEX, COUNT', tk('LED index (int) and LED count')],
  ['STRIP, ALONG', tk('Segment index, and position along the segment 0..1')],
  ['palette(h), palette(h, s, v)', tk('Scene palette color, follows the hue shift')],
  ['hsv(h, s, v)', tk('HSV to RGB')],
  ['hash(x), noise(p), fbm(p)', tk('Random, smooth 3D noise, fractal noise 0..1')],
  ['uniform float k; // 0.5 [0, 1]', tk('Parameter: default and range, modulable in the graph')],
  ['uniform vec3 c; // #ff6600', tk('Color parameter')],
];

export interface PresetDef {
  id: string;
  label: string;
  short: string;
  description: string;
  code: string;
}

export const PRESETS: PresetDef[] = [
  {
    id: 'sphere',
    label: tk('Spherical Wave'),
    short: 'SPHERE',
    description: tk('Radial wave from the scene origin, shell at radius'),
    code: `vec3 shade(vec3 p) {
  float d = distance(p, ORIGIN);
  float r = max(RADIUS, 0.05);
  float e = d - r;
  float shell = exp(-(e * e) / (2.0 * 0.12 * 0.12));
  float ripple = pow(0.5 + 0.5 * cos(d * 5.0 - PHASE * 4.0), 4.0) * exp(-d / r * 0.6);
  float v = clamp(shell + ripple * 0.55, 0.0, 1.0);
  return palette(0.52 + d * 0.08, clamp(0.9 - shell * 0.55, 0.0, 1.0), v);
}
`,
  },
  {
    id: 'plasma',
    label: tk('Plasma Field'),
    short: 'PLASMA',
    description: tk('Trigonometric 3D interference field over X, Y, Z'),
    code: `vec3 shade(vec3 p) {
  float t = PHASE;
  float d = distance(p, ORIGIN);
  float a = sin(p.x * 1.7 + t * 0.9) + sin(p.y * 2.3 - t * 1.1) + sin(p.z * 1.9 + t * 0.7)
          + sin((p.x + p.z) * 1.1 + p.y * 1.5 + t * 0.5) + sin(d * (6.0 / max(RADIUS, 0.2)) - t * 1.3);
  float n = a / 5.0;
  float v = 0.2 + 0.8 * pow(0.5 + 0.5 * sin(n * TAU), 1.5);
  return palette(n * 0.35 + t * 0.02, 0.85, v);
}
`,
  },
  {
    id: 'laser',
    label: tk('Laser Plane'),
    short: 'LASER',
    description: tk('Light plane sweeping the X axis'),
    code: `vec3 shade(vec3 p) {
  float px = ORIGIN.x + sin(PHASE * 0.8) * ROOM.x * 0.5;
  float dir = cos(PHASE * 0.8) >= 0.0 ? 1.0 : -1.0;
  float w = 0.05 + RADIUS * 0.04;
  float d = p.x - px;
  float core = exp(-(d * d) / (2.0 * w * w));
  float trail = d * dir < 0.0 ? exp(-abs(d) / 0.6) * 0.3 : 0.0;
  return palette(0.52, clamp(0.95 - core * 0.8, 0.0, 1.0), clamp(core + trail, 0.0, 1.0));
}
`,
  },
  {
    id: 'height',
    label: tk('Height Spectrum'),
    short: 'HEIGHT',
    description: tk('Hue gradient indexed on LED height Y'),
    code: `vec3 shade(vec3 p) {
  float yn = clamp(p.y / ROOM.y, 0.0, 1.0);
  float band = 0.5 + 0.5 * sin(p.y * 7.0 - PHASE * 2.5);
  return palette(yn * 0.75 + PHASE * 0.03, 0.9, 0.35 + 0.65 * band * band);
}
`,
  },
  {
    id: 'fire',
    label: tk('Fire'),
    short: 'FIRE',
    description: tk('Rising flames from fractal noise, hotter near the floor'),
    code: `uniform float scale; // 1.6 [0.2, 6]
uniform float rise; // 1.5 [0, 5]
uniform float height; // 0.9 [0.1, 2]

vec3 shade(vec3 p) {
  float h = clamp(p.y / ROOM.y, 0.0, 1.0);
  float n = fbm(vec3(p.x * scale, p.y * scale - PHASE * rise, p.z * scale + PHASE * 0.2));
  float heat = clamp(n * 1.5 - h / height + 0.35, 0.0, 1.0);
  return vec3(heat * 1.4, heat * heat * 1.1, pow(heat, 4.0) * 0.8);
}
`,
  },
  {
    id: 'twinkle',
    label: tk('Twinkle'),
    short: 'TWINKLE',
    description: tk('Random sparkles that fade out'),
    code: `uniform float density; // 0.08 [0, 1]
uniform float rate; // 3 [0.2, 20]
uniform float decay; // 3 [0.2, 12]
uniform vec3 tint; // #fff1d6

vec3 shade(vec3 p) {
  float seed = hash(float(INDEX)) * 7.0;
  float slot = floor(TIME * rate + seed);
  float on = step(1.0 - density, hash(float(INDEX) * 13.1 + slot));
  float age = fract(TIME * rate + seed);
  return tint * on * exp(-age * decay);
}
`,
  },
  {
    id: 'chase',
    label: tk('Chase'),
    short: 'CHASE',
    description: tk('Comets running along each segment'),
    code: `uniform float comets; // 3 [1, 12]
uniform float tail; // 0.3 [0.02, 1]

vec3 shade(vec3 p) {
  float x = fract(ALONG * comets - PHASE * 0.5);
  float v = pow(x, 1.0 / tail);
  return palette(STRIP * 0.17 + ALONG * 0.2, 1.0 - v * 0.4, v);
}
`,
  },
  {
    id: 'solid',
    label: tk('Solid Color'),
    short: 'SOLID',
    description: tk('One color, useful as a base or a mask layer'),
    code: `uniform vec3 color; // #ff2a6d

vec3 shade(vec3 p) {
  return color;
}
`,
  },
];

export interface FloatParam {
  kind: 'float';
  name: string;
  value: number;
  min: number;
  max: number;
}
export interface ColorParam {
  kind: 'color';
  name: string;
  value: string;
}
export type ShaderParam = FloatParam | ColorParam;

const UNIFORM_RE = /^[ \t]*uniform[ \t]+(float|vec3)[ \t]+([A-Za-z_]\w*)[ \t]*;[ \t]*(?:\/\/(.*))?$/gm;
const HEX_RE = /#[0-9a-fA-F]{6}\b/;
const cache = new Map<string, ShaderParam[]>();

/** Parameters declared in a layer's code, with their defaults and ranges. */
export function parseParams(code: string): ShaderParam[] {
  const hit = cache.get(code);
  if (hit) return hit;
  const out: ShaderParam[] = [];
  for (const [, type, name, comment = ''] of code.matchAll(UNIFORM_RE)) {
    if (type === 'vec3') {
      out.push({ kind: 'color', name, value: (comment.match(HEX_RE)?.[0] ?? '#ffffff').toLowerCase() });
      continue;
    }
    const range = comment.match(/\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/);
    const min = range ? Number(range[1]) : 0;
    const max = range && Number(range[2]) > min ? Number(range[2]) : min + 1;
    const def = Number(comment.replace(/\[.*?\]/, '').match(/-?\d*\.?\d+/)?.[0] ?? (min + max) / 2);
    out.push({ kind: 'float', name, value: Math.min(max, Math.max(min, def)), min, max });
  }
  if (cache.size > 256) cache.clear();
  cache.set(code, out);
  return out;
}

export const hexToRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255 || 0) as [number, number, number];

export const presetById = (id: string) => PRESETS.find((p) => p.id === id);
/** The preset a layer currently runs unchanged, if any. */
export const presetOf = (layer: EffectLayer) => PRESETS.find((p) => p.code === layer.code);

export function makeLayer(id: string, presetId: string, name?: string): EffectLayer {
  const preset = presetById(presetId) ?? PRESETS[0];
  return { id, name: name ?? preset.short, enabled: true, code: preset.code, blend: 'normal', opacity: 1, mask: [], params: {}, colors: {} };
}

export const LAYER_DEFAULTS: Omit<EffectLayer, 'id' | 'code'> = { name: 'Layer', enabled: true, blend: 'normal', opacity: 1, mask: [], params: {}, colors: {} };

/* ------------------------------------------------------------------ */
/* Route targets on layers                                             */
/* ------------------------------------------------------------------ */

export const OPACITY_KEY = '@opacity';
export const layerTarget = (layerId: string, key: string): RouteTarget => `layer:${layerId}:${key}`;

/** Splits `layer:<id>:<key>`; null for scene targets. */
export function parseLayerTarget(target: RouteTarget): { layerId: string; key: string } | null {
  if (!target.startsWith('layer:')) return null;
  const rest = target.slice(6);
  const i = rest.indexOf(':');
  return i < 0 ? null : { layerId: rest.slice(0, i), key: rest.slice(i + 1) };
}

export interface ResolvedTarget extends TargetMeta {
  /** For layer targets, the base value and bounds the modulation adds to. */
  layer?: { id: string; name: string; key: string; min: number; max: number };
}

/** Label, range and unit of any route target, or null when its layer or parameter no longer exists. */
export function resolveTarget(target: RouteTarget, layers: EffectLayer[]): ResolvedTarget | null {
  const lt = parseLayerTarget(target);
  if (!lt) return TARGET_META[target as keyof typeof TARGET_META] ?? null;
  const layer = layers.find((l) => l.id === lt.layerId);
  if (!layer) return null;
  if (lt.key === OPACITY_KEY) {
    return { label: tk('Opacity'), detail: layer.name, range: 1, unit: '%', layer: { id: layer.id, name: layer.name, key: lt.key, min: 0, max: 1 } };
  }
  const p = parseParams(layer.code).find((x): x is FloatParam => x.kind === 'float' && x.name === lt.key);
  if (!p) return null;
  return { label: p.name, detail: layer.name, range: p.max - p.min, unit: '', layer: { id: layer.id, name: layer.name, key: p.name, min: p.min, max: p.max } };
}

/** Every modulable input of a layer: opacity, then its float parameters. */
export const layerInputs = (layer: EffectLayer): { key: string; target: RouteTarget }[] => [
  { key: OPACITY_KEY, target: layerTarget(layer.id, OPACITY_KEY) },
  ...parseParams(layer.code)
    .filter((p) => p.kind === 'float')
    .map((p) => ({ key: p.name, target: layerTarget(layer.id, p.name) })),
];
