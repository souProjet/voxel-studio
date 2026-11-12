export type Vec3 = [number, number, number];

export type LedChipset = 'WS2811' | 'WS2812B' | 'WS2815';
export type StripShape = 'line' | 'helix';

export interface LEDStrip {
  id: string;
  name: string;
  deviceId: string;
  gpio: number;
  chipset: LedChipset;
  ledCount: number;
  shape: StripShape;
  start: Vec3;
  end: Vec3;
  /** Helix only: radius in meters around the start->end axis. */
  helixRadius: number;
  /** Helix only: number of full turns between start and end. */
  helixTurns: number;
  visible: boolean;
}

export type DeviceProtocol = 'DDP' | 'OSC';

export interface ESP32Device {
  id: string;
  name: string;
  chip: string;
  ip: string;
  mac: string;
  port: number;
  protocol: DeviceProtocol;
  firmware: 'WLED' | 'Custom';
  psuVoltage: 5 | 12;
  psuMaxAmps: number;
  /** WLED-style automatic brightness limiter, as a fraction of psuMaxAmps. */
  currentLimiter: boolean;
  online: boolean;
}

export type ModTarget =
  | 'sphere_radius'
  | 'shader_speed'
  | 'color_shift'
  | 'strobe_override'
  | 'master_brightness'
  | 'origin_y'
  | 'local_intensity'
  | 'local_wave';

export type CurveType = 'linear' | 'exp' | 'scurve' | 'step';

export interface ModulationRoute {
  id: string;
  /** Sensor channel key, `${sensorId}.${channelId}`. */
  source: ChannelKey;
  target: ModTarget;
  curve: CurveType;
  /** Bipolar depth, -1..+1. */
  amount: number;
  /** When true the normalized source is remapped to -1..+1 around its midpoint. */
  bipolar: boolean;
  enabled: boolean;
}

/* ------------------------------------------------------------------ */
/* Sensors                                                             */
/* ------------------------------------------------------------------ */

export type SensorKind = 'audio' | 'gps' | 'gpio' | 'gyro';

/** Registered signal sources (src/services/sensors.ts). Only the simulator ships today. */
export type SensorSourceId = 'sim';

export type Falloff = 'linear' | 'smooth' | 'gaussian';

export type SimScenario = 'electro' | 'ambient' | 'speech' | 'silence' | 'drive' | 'city' | 'sway';

export interface AudioBand {
  id: string;
  label: string;
  lowHz: number;
  highHz: number;
  /** Linear gain applied to the band energy before the envelope. */
  gain: number;
  attackMs: number;
  releaseMs: number;
}

export interface SensorSimConfig {
  mode: 'auto' | 'manual';
  scenario: SimScenario;
  bpm: number;
  /** Manual values per channel id, in the channel's raw unit (km/h, degrees, 0..1). */
  manual: Record<string, number>;
}

export interface SensorNode {
  id: string;
  name: string;
  kind: SensorKind;
  /** ESP32 hosting the sensor, if any. */
  deviceId: string | null;
  source: SensorSourceId;
  /** Physical location in the room, used by spatial (local_*) modulation. */
  position: Vec3;
  /** Spatial influence radius in meters. */
  radius: number;
  falloff: Falloff;
  enabled: boolean;
  visible: boolean;
  /** Audio only: band split of the spectrum, one modulation channel per band. */
  bands: AudioBand[];
  sim: SensorSimConfig;
}

export type ChannelKey = string;

export interface SensorChannel {
  key: ChannelKey;
  sensorId: string;
  channelId: string;
  label: string;
  unit: string;
  /** Raw range mapped to 0..1. */
  min: number;
  max: number;
}

export type ShaderId = 'spherical_wave' | 'perlin_plasma' | 'laser_plane' | 'height_spectrum';

export interface ShaderPreset {
  id: ShaderId;
  label: string;
  short: string;
  description: string;
}

export interface EffectParams {
  origin: Vec3;
  radius: number;
  speed: number;
  /** Hue rotation, 0..1 turns. */
  hueShift: number;
  /** 0..1 */
  masterBrightness: number;
}

/** Params after modulation, consumed by shaderMath at render time. */
export interface ResolvedParams extends EffectParams {
  strobe: boolean;
}

export type ViewId = 'studio' | 'scanner' | 'patcher' | 'devices' | 'livepad';

export interface ScanState {
  active: boolean;
  /** 0-based Gray-code bit currently projected by the LEDs. */
  bit: number;
}

export interface DeviceRuntimeStats {
  fps: number;
  latencyMs: number;
  amps: number;
  watts: number;
  limited: boolean;
  packetsPerFrame: number;
  rssi: number;
}

export interface EngineStats {
  renderFps: number;
  ddpFps: number;
  totalWatts: number;
  totalAmps12: number;
  totalAmps5: number;
  activeVoxels: number;
  effectiveRadius: number;
  effectiveSpeed: number;
  effectiveHueShift: number;
  effectiveBrightness: number;
  strobeActive: boolean;
  devices: Record<string, DeviceRuntimeStats>;
}
