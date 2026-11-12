import type { CurveType, LedChipset, ModTarget, SensorKind, ShaderPreset, SimScenario } from '../types/voxel';

export const MAX_LEDS = 2000;
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

export const SHADER_PRESETS: ShaderPreset[] = [
  { id: 'spherical_wave', label: 'Spherical Wave', short: 'SPHERE', description: 'Radial wave from the effect origin, shell at radius' },
  { id: 'perlin_plasma', label: 'Plasma Field', short: 'PLASMA', description: 'Trigonometric 3D interference field over X, Y, Z' },
  { id: 'laser_plane', label: 'Laser Plane', short: 'LASER', description: 'Light plane sweeping the X axis' },
  { id: 'height_spectrum', label: 'Height Spectrum', short: 'HEIGHT', description: 'Hue gradient indexed on LED height Y' },
];

export const KIND_META: Record<SensorKind, { label: string; color: string; hardware: string }> = {
  audio: { label: 'Audio', color: '#D946EF', hardware: 'I2S mic (INMP441)' },
  gps: { label: 'GPS', color: '#F59E0B', hardware: 'UART GPS (NEO-M8N)' },
  gpio: { label: 'GPIO', color: '#10B981', hardware: 'Digital input' },
  gyro: { label: 'Gyro', color: '#06B6D4', hardware: 'IMU (MPU6050)' },
};

export const SCENARIOS: Record<SensorKind, { value: SimScenario; label: string }[]> = {
  audio: [
    { value: 'electro', label: 'Electro (4/4)' },
    { value: 'ambient', label: 'Ambient pad' },
    { value: 'speech', label: 'Speech' },
    { value: 'silence', label: 'Silence' },
  ],
  gps: [
    { value: 'drive', label: 'Highway drive' },
    { value: 'city', label: 'City stop & go' },
  ],
  gpio: [],
  gyro: [{ value: 'sway', label: 'Pendulum sway' }],
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
  sphere_radius: { label: 'Sphere Radius', detail: '3D influence radius', range: 2, unit: 'm' },
  shader_speed: { label: 'Time Frequency', detail: 'Shader speed', range: 4, unit: 'x' },
  color_shift: { label: 'Chroma Shift', detail: 'Hue rotation', range: 0.5, unit: 'turn' },
  strobe_override: { label: 'Strobe Override', detail: 'Flash above 50%', range: 1, unit: '' },
  master_brightness: { label: 'Master Bright.', detail: 'Output gain', range: 1, unit: '%' },
  origin_y: { label: 'Origin Y', detail: 'Effect height', range: 1.2, unit: 'm' },
  local_intensity: { label: 'Local Intensity', detail: 'Per-LED gain near sensor', range: 2, unit: 'x', spatial: true },
  local_wave: { label: 'Local Wave', detail: 'Ring from sensor on onset', range: 1, unit: '', spatial: true },
};

export const CURVES: CurveType[] = ['linear', 'exp', 'scurve', 'step'];

export const AXIS_COLOR = { x: '#EF4444', y: '#22C55E', z: '#3B82F6' } as const;
