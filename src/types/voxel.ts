export type Vec3 = [number, number, number];

export type LedChipset = 'WS2811' | 'WS2812B' | 'WS2815';
export type StripShape = 'line' | 'helix' | 'polyline' | 'arc' | 'matrix' | 'points';
/** Byte order on the wire. WLED reorders itself, so keep RGB for WLED; other values serve custom firmware. */
export type ColorOrder = 'RGB' | 'GRB' | 'BRG' | 'RBG' | 'GBR' | 'BGR';
export type Axis = 'x' | 'y' | 'z';

export interface LEDStrip {
  id: string;
  name: string;
  deviceId: string;
  gpio: number;
  chipset: LedChipset;
  /** Physical LEDs on the wire, skipped ones included. */
  ledCount: number;
  shape: StripShape;
  /** line / helix: path ends. arc: center (start). matrix: opposite corners. */
  start: Vec3;
  end: Vec3;
  /** helix: radius around the axis. arc: circle radius. */
  helixRadius: number;
  /** helix only: full turns between start and end. */
  helixTurns: number;
  visible: boolean;
  /** Data enters at the `end` of the path instead of `start`. */
  reversed: boolean;
  /** LEDs present on the wire but unmapped (hidden or sacrificial), kept dark. */
  skipStart: number;
  skipEnd: number;
  /** Per-segment output gain, 0..1. */
  gain: number;
  colorOrder: ColorOrder;
  /** polyline: path vertices. points: one position per active LED (imported). */
  points: Vec3[];
  /** arc: axis normal to the circle, start angle and sweep in degrees. */
  arcAxis: Axis;
  arcStartDeg: number;
  arcSweepDeg: number;
  /** matrix: grid size and zig-zag wiring. */
  matrixCols: number;
  matrixRows: number;
  serpentine: boolean;
}

export type TestPattern = 'off' | 'identify' | 'white' | 'red' | 'green' | 'blue' | 'chase';

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
  /** Input window: the route responds to the source between inMin and inMax (0..1). */
  inMin: number;
  inMax: number;
  /** Output slew time constant in ms (0 = immediate). */
  smoothMs: number;
  /** Optional channel that scales `amount` (0..1), for modulating a modulation. */
  amountSource: ChannelKey | null;
}

/* ------------------------------------------------------------------ */
/* Generators: internal modulation sources                            */
/* ------------------------------------------------------------------ */

export type GeneratorKind = 'lfo' | 'envelope' | 'macro' | 'osc' | 'midi';
export type LfoShape = 'sine' | 'triangle' | 'saw' | 'square' | 'random';

/** One output channel, `${id}.out`. Fields unused by a kind keep their defaults. */
export interface Generator {
  id: string;
  name: string;
  kind: GeneratorKind;
  enabled: boolean;
  /** lfo */
  shape: LfoShape;
  rateHz: number;
  /** lfo: follow the effect tempo, one cycle every `beats` beats. */
  tempoSync: boolean;
  beats: number;
  /** lfo: phase offset, 0..1 of a cycle. */
  phase: number;
  /** envelope: retriggers when this channel rises above `threshold`. */
  trigger: ChannelKey | null;
  threshold: number;
  attackMs: number;
  decayMs: number;
  sustain: number;
  releaseMs: number;
  /** macro: knob value, 0..1. */
  value: number;
  /** osc: incoming address. midi: control key (cc/<ch>/<n>, note/<ch>/<n>, pb/<ch>). Raw range mapped to 0..1. */
  address: string;
  min: number;
  max: number;
}

/* ------------------------------------------------------------------ */
/* Sensors                                                             */
/* ------------------------------------------------------------------ */

export type SensorKind = 'audio' | 'gps' | 'gpio' | 'gyro';

/** Registered signal sources (src/services/sensors.ts). */
export type SensorSourceId = 'sim' | 'mic' | 'wled-sync' | 'osc';

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

export type PaletteId = 'spectrum' | 'fire' | 'ocean' | 'forest' | 'sunset' | 'ice';

export interface EffectParams {
  origin: Vec3;
  radius: number;
  speed: number;
  /** Hue rotation, 0..1 turns (moves along the palette). */
  hueShift: number;
  /** 0..1 */
  masterBrightness: number;
  /** Color gradient the shaders index; 'spectrum' is the full HSV wheel. */
  palette: PaletteId;
  /** Crossfade duration when switching shaders, seconds (0 = cut). */
  fadeSec: number;
  bpm: number;
  /** When on, shader speed follows the tempo (120 BPM = 1x). */
  bpmSync: boolean;
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
  /** Failed sends since the app started. */
  errors: number;
  lastError: string;
}

/** Result of the periodic reachability probe (WLED HTTP port). */
export interface DeviceHealth {
  reachable: boolean;
  rttMs: number;
  checkedAt: number;
}

export interface Notice {
  id: number;
  text: string;
  tone: 'info' | 'error';
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
