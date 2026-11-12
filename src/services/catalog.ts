import type { CurveType, EffectParams, LedChipset, ModTarget, PaletteId, SensorKind, SimScenario } from '../types/voxel';
import { tk } from '../i18n';

/** Total LEDs per project. Layers shade on the GPU; the per-LED post passes (spatial fields, limiter, DDP) stay on the CPU. */
export const MAX_LEDS = 16384;
export const DDP_PORT = 4048;
export const DDP_SEND_HZ = 40;
export const GPS_MAX_KMH = 160;
/** Automatic brightness limiter engages above this fraction of the PSU rating. */
export const LIMITER_RATIO = 0.85;

/** Room envelope in meters (x: width, y: height, z: depth), centered on x/z, floor at y = 0. */
export const ROOM = { width: 7, height: 2.4, depth: 5 } as const;

export interface ChipsetSpec {
  voltage: 5 | 12;
  /** Full-white current per addressable pixel, mA (20 mA per channel class at nominal voltage). */
  maFullWhite: number;
  /** Quiescent current per IC, mA. */
  maIdle: number;
}

export const CHIPSETS: Record<LedChipset, ChipsetSpec> = {
  WS2812B: { voltage: 5, maFullWhite: 60, maIdle: 1 },
  WS2815: { voltage: 12, maFullWhite: 20, maIdle: 1 },
  WS2811: { voltage: 12, maFullWhite: 20, maIdle: 1 },
};

/** Effect fields added after the first project format; also the defaults for older files. */
export const EFFECT_DEFAULTS: Pick<EffectParams, 'palette' | 'fadeSec' | 'bpm' | 'bpmSync'> = {
  palette: 'spectrum',
  fadeSec: 1,
  bpm: 120,
  bpmSync: false,
};

/** Cyclic gradients (last stop wraps to the first). Saturation and value still come from the shader. */
export const PALETTES: Record<PaletteId, { label: string; stops: [number, string][] }> = {
  spectrum: { label: tk('Spectrum'), stops: [] },
  fire: {
    label: tk('Fire'),
    stops: [
      [0, '#ff1a00'],
      [0.3, '#ff7a00'],
      [0.55, '#ffd23f'],
      [0.8, '#ff4500'],
      [1, '#ff1a00'],
    ],
  },
  ocean: {
    label: tk('Ocean'),
    stops: [
      [0, '#0033ff'],
      [0.3, '#00b4ff'],
      [0.55, '#00ffc8'],
      [0.8, '#0077ff'],
      [1, '#0033ff'],
    ],
  },
  forest: {
    label: tk('Forest'),
    stops: [
      [0, '#00c03a'],
      [0.35, '#9dff00'],
      [0.65, '#00ff9c'],
      [1, '#00c03a'],
    ],
  },
  sunset: {
    label: tk('Sunset'),
    stops: [
      [0, '#ff0058'],
      [0.3, '#ff6a00'],
      [0.55, '#ffb300'],
      [0.8, '#b000ff'],
      [1, '#ff0058'],
    ],
  },
  ice: {
    label: tk('Ice'),
    stops: [
      [0, '#5ad1ff'],
      [0.4, '#ffffff'],
      [0.7, '#3d6bff'],
      [1, '#5ad1ff'],
    ],
  },
};

export const KIND_META: Record<SensorKind, { label: string; color: string; hardware: string }> = {
  audio: { label: 'Audio', color: '#D946EF', hardware: tk('I2S mic (INMP441)') },
  gps: { label: 'GPS', color: '#F59E0B', hardware: tk('UART GPS (NEO-M8N)') },
  gpio: { label: 'GPIO', color: '#10B981', hardware: tk('Digital input') },
  gyro: { label: tk('Gyro'), color: '#06B6D4', hardware: 'IMU (MPU6050)' },
};

export const SCENARIOS: Record<SensorKind, { value: SimScenario; label: string }[]> = {
  audio: [
    { value: 'electro', label: tk('Electro (4/4)') },
    { value: 'ambient', label: tk('Ambient pad') },
    { value: 'speech', label: tk('Speech') },
    { value: 'silence', label: 'Silence' },
  ],
  gps: [
    { value: 'drive', label: tk('Highway drive') },
    { value: 'city', label: tk('City stop & go') },
  ],
  gpio: [],
  gyro: [{ value: 'sway', label: tk('Pendulum sway') }],
};

export interface TargetMeta {
  label: string;
  detail: string;
  /** Full-scale contribution of a route with amount = 1 and curve output = 1. */
  range: number;
  unit: string;
  /** Evaluated per LED around the source sensor's position instead of globally. */
  spatial?: boolean;
}

export const TARGET_META: Record<ModTarget, TargetMeta> = {
  sphere_radius: { label: tk('Sphere Radius'), detail: tk('3D influence radius'), range: 2, unit: 'm' },
  shader_speed: { label: tk('Time Frequency'), detail: tk('Shader speed'), range: 4, unit: 'x' },
  color_shift: { label: tk('Chroma Shift'), detail: tk('Hue rotation'), range: 0.5, unit: 'turn' },
  strobe_override: { label: tk('Strobe Override'), detail: tk('Flash above 50%'), range: 1, unit: '' },
  master_brightness: { label: tk('Master Bright.'), detail: tk('Output gain'), range: 1, unit: '%' },
  origin_y: { label: tk('Origin Y'), detail: tk('Effect height'), range: 1.2, unit: 'm' },
  local_intensity: { label: tk('Local Intensity'), detail: tk('Per-LED gain near sensor'), range: 2, unit: 'x', spatial: true },
  local_wave: { label: tk('Local Wave'), detail: tk('Ring from sensor on onset'), range: 1, unit: '', spatial: true },
};

/** Spatial targets act per LED around the source sensor; layer targets are never spatial. */
export const isSpatialTarget = (target: string) => (TARGET_META as Record<string, TargetMeta | undefined>)[target]?.spatial === true;

export const CURVES: CurveType[] = ['linear', 'exp', 'scurve', 'step'];

export const AXIS_COLOR = { x: '#EF4444', y: '#22C55E', z: '#3B82F6' } as const;
