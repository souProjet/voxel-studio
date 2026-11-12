import { createContext, createElement, useContext, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type {
  AudioBand,
  EffectParams,
  EngineStats,
  ESP32Device,
  LEDStrip,
  ModulationRoute,
  ScanState,
  SensorKind,
  SensorNode,
  ShaderId,
  Vec3,
  ViewId,
} from '../types/voxel';
import { KIND_META, MAX_LEDS, SCENARIOS } from '../services/catalog';
import { allChannels, channelKey, sensorIdOf } from '../services/sensors';

export interface VoxelState {
  view: ViewId;
  strips: LEDStrip[];
  devices: ESP32Device[];
  routes: ModulationRoute[];
  sensors: SensorNode[];
  /** Normalized channel values (0..1), published by the engine at the sensor tick rate. */
  sensorValues: Record<string, number>;
  shader: ShaderId;
  params: EffectParams;
  selectedStripId: string | null;
  selectedSensorId: string | null;
  selectedRouteId: string | null;
  showRoom: boolean;
  showSphere: boolean;
  ddpOutput: boolean;
  manualStrobe: boolean;
  scan: ScanState;
  stats: EngineStats;
}

type Update = Partial<VoxelState> | ((s: VoxelState) => Partial<VoxelState>);

/**
 * Minimal external store. React components subscribe through selectors (useSyncExternalStore),
 * while the 60 FPS render loop reads `store.getState()` directly: the "synchronized ref" that
 * never triggers a React render.
 */
export interface VoxelStore {
  getState(): VoxelState;
  setState(update: Update): void;
  subscribe(listener: () => void): () => void;
}

let idCounter = 0;
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(idCounter++).toString(36)}`;

const INITIAL_DEVICES: ESP32Device[] = [
  {
    id: 'esp-salon',
    name: 'ESP32-S3-Salon-Master',
    chip: 'ESP32-S3 N16R8',
    ip: '192.168.1.42',
    mac: '34:85:18:7A:C2:10',
    port: 4048,
    protocol: 'DDP',
    firmware: 'WLED',
    psuVoltage: 12,
    psuMaxAmps: 10,
    currentLimiter: true,
    online: true,
  },
  {
    id: 'esp-plafond',
    name: 'ESP32-Plafond-Helix',
    chip: 'ESP32-WROOM-32E',
    ip: '192.168.1.45',
    mac: '08:3A:F2:51:9D:64',
    port: 4048,
    protocol: 'DDP',
    firmware: 'WLED',
    psuVoltage: 12,
    psuMaxAmps: 5,
    currentLimiter: true,
    online: true,
  },
  {
    id: 'esp-telemetry',
    name: 'ESP32-Télémétrie-Capteurs',
    chip: 'ESP32-C3',
    ip: '192.168.1.99',
    mac: '58:CF:79:E3:04:B8',
    port: 9000,
    protocol: 'OSC',
    firmware: 'Custom',
    psuVoltage: 5,
    psuMaxAmps: 1,
    currentLimiter: false,
    online: true,
  },
];

const INITIAL_STRIPS: LEDStrip[] = [
  {
    id: 'strip-nord',
    name: 'Corniche Plafond Nord',
    deviceId: 'esp-salon',
    gpio: 2,
    chipset: 'WS2815',
    ledCount: 180,
    shape: 'line',
    start: [-3.5, 2.2, -2.5],
    end: [3.5, 2.2, -2.5],
    helixRadius: 0.5,
    helixTurns: 6,
    visible: true,
  },
  {
    id: 'strip-ouest',
    name: 'Corniche Plafond Ouest',
    deviceId: 'esp-salon',
    gpio: 4,
    chipset: 'WS2815',
    ledCount: 140,
    shape: 'line',
    start: [-3.5, 2.2, -2.5],
    end: [-3.5, 2.2, 2.5],
    helixRadius: 0.5,
    helixTurns: 6,
    visible: true,
  },
  {
    id: 'strip-helix',
    name: 'Suspension Hélicoïdale 3D',
    deviceId: 'esp-plafond',
    gpio: 16,
    chipset: 'WS2811',
    ledCount: 200,
    shape: 'helix',
    start: [0, 0.3, 0],
    end: [0, 2.3, 0],
    helixRadius: 0.45,
    helixTurns: 7,
    visible: true,
  },
  {
    id: 'strip-plinthe',
    name: 'Plinthe Sol Meuble TV',
    deviceId: 'esp-salon',
    gpio: 15,
    chipset: 'WS2812B',
    ledCount: 120,
    shape: 'line',
    start: [-2.8, 0.08, 2.4],
    end: [2.8, 0.08, 2.4],
    helixRadius: 0.5,
    helixTurns: 6,
    visible: true,
  },
];

const sim = (patch: Partial<SensorNode['sim']> = {}): SensorNode['sim'] => ({
  mode: 'auto',
  scenario: 'electro',
  bpm: 124,
  manual: {},
  ...patch,
});

const DEFAULT_BANDS: AudioBand[] = [
  { id: 'bass', label: 'Sub', lowHz: 40, highHz: 90, gain: 1.4, attackMs: 8, releaseMs: 140 },
  { id: 'mid', label: 'Mid', lowHz: 300, highHz: 2000, gain: 2.2, attackMs: 20, releaseMs: 220 },
  { id: 'high', label: 'High', lowHz: 4000, highHz: 12000, gain: 1.6, attackMs: 4, releaseMs: 90 },
];

const INITIAL_SENSORS: SensorNode[] = [
  {
    id: 'mic-salon',
    name: 'Mic INMP441 Salon',
    kind: 'audio',
    deviceId: 'esp-salon',
    source: 'sim',
    position: [-2.4, 1.0, 2.2],
    radius: 3,
    falloff: 'smooth',
    enabled: true,
    visible: true,
    bands: DEFAULT_BANDS,
    sim: sim(),
  },
  {
    id: 'gps-neo',
    name: 'GPS NEO-M8N',
    kind: 'gps',
    deviceId: 'esp-telemetry',
    source: 'sim',
    position: [3.2, 0.6, -2.2],
    radius: 2,
    falloff: 'smooth',
    enabled: true,
    visible: true,
    bands: [],
    sim: sim({ mode: 'manual', scenario: 'drive', manual: { speed: 42 } }),
  },
  {
    id: 'btn-18',
    name: 'Button GPIO18',
    kind: 'gpio',
    deviceId: 'esp-salon',
    source: 'sim',
    position: [-3.3, 1.0, 1.6],
    radius: 2,
    falloff: 'smooth',
    enabled: true,
    visible: true,
    bands: [],
    sim: sim({ mode: 'manual', manual: { pressed: 0 } }),
  },
  {
    id: 'gyro-helix',
    name: 'Gyro MPU6050 Helix',
    kind: 'gyro',
    deviceId: 'esp-plafond',
    source: 'sim',
    position: [0, 2.35, 0],
    radius: 1.5,
    falloff: 'smooth',
    enabled: true,
    visible: true,
    bands: [],
    sim: sim({ mode: 'manual', scenario: 'sway', manual: { pitch: 0 } }),
  },
];

const INITIAL_ROUTES: ModulationRoute[] = [
  { id: 'route-bass', source: 'mic-salon.bass', target: 'sphere_radius', curve: 'exp', amount: 0.85, bipolar: false, enabled: true },
  { id: 'route-gps', source: 'gps-neo.speed', target: 'shader_speed', curve: 'linear', amount: 0.65, bipolar: false, enabled: true },
  { id: 'route-high', source: 'mic-salon.high', target: 'color_shift', curve: 'scurve', amount: 0.45, bipolar: true, enabled: true },
  { id: 'route-btn', source: 'btn-18.pressed', target: 'strobe_override', curve: 'step', amount: 1, bipolar: false, enabled: true },
  { id: 'route-wave', source: 'mic-salon.bass', target: 'local_wave', curve: 'linear', amount: 1, bipolar: false, enabled: true },
  { id: 'route-local', source: 'mic-salon.mid', target: 'local_intensity', curve: 'scurve', amount: 0.6, bipolar: false, enabled: true },
];

const EMPTY_STATS: EngineStats = {
  renderFps: 0,
  ddpFps: 0,
  totalWatts: 0,
  totalAmps12: 0,
  totalAmps5: 0,
  activeVoxels: 0,
  effectiveRadius: 0,
  effectiveSpeed: 0,
  effectiveHueShift: 0,
  effectiveBrightness: 0,
  strobeActive: false,
  devices: {},
};

function initialState(): VoxelState {
  return {
    view: 'studio',
    strips: INITIAL_STRIPS,
    devices: INITIAL_DEVICES,
    routes: INITIAL_ROUTES,
    sensors: INITIAL_SENSORS,
    sensorValues: {},
    shader: 'spherical_wave',
    params: { origin: [0, 1.2, 0], radius: 1.4, speed: 1, hueShift: 0, masterBrightness: 0.8 },
    selectedStripId: 'strip-helix',
    selectedSensorId: null,
    selectedRouteId: 'route-bass',
    showRoom: true,
    showSphere: true,
    ddpOutput: true,
    manualStrobe: false,
    scan: { active: false, bit: 0 },
    stats: EMPTY_STATS,
  };
}

export function createVoxelStore(): VoxelStore {
  let state = initialState();
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    setState(update) {
      const patch = typeof update === 'function' ? update(state) : update;
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const totalLeds = (strips: LEDStrip[]) => strips.reduce((n, s) => n + s.ledCount, 0);

function createActions(store: VoxelStore) {
  const set = store.setState;
  return {
    setView: (view: ViewId) => set({ view }),
    setShader: (shader: ShaderId) => set({ shader }),
    setParams: (patch: Partial<EffectParams>) => set((s) => ({ params: { ...s.params, ...patch } })),
    setOriginAxis: (axis: 0 | 1 | 2, value: number) =>
      set((s) => {
        const origin = [...s.params.origin] as Vec3;
        origin[axis] = value;
        return { params: { ...s.params, origin } };
      }),
    setManualStrobe: (manualStrobe: boolean) => set({ manualStrobe }),
    toggle: (key: 'showRoom' | 'showSphere' | 'ddpOutput') => set((s) => ({ [key]: !s[key] })),
    setScan: (scan: Partial<ScanState>) => set((s) => ({ scan: { ...s.scan, ...scan } })),

    selectStrip: (selectedStripId: string | null) => set({ selectedStripId, selectedSensorId: null }),
    updateStrip: (id: string, patch: Partial<LEDStrip>) =>
      set((s) => ({
        strips: s.strips.map((strip) => {
          if (strip.id !== id) return strip;
          const next = { ...strip, ...patch };
          const others = totalLeds(s.strips) - strip.ledCount;
          next.ledCount = Math.max(1, Math.min(Math.round(next.ledCount), MAX_LEDS - others));
          return next;
        }),
      })),
    addStrip: () =>
      set((s) => {
        const free = MAX_LEDS - totalLeds(s.strips);
        if (free <= 0) return {};
        const device = s.devices.find((d) => d.protocol === 'DDP') ?? s.devices[0];
        const used = new Set(s.strips.filter((x) => x.deviceId === device.id).map((x) => x.gpio));
        const gpio = [2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23].find((g) => !used.has(g)) ?? 0;
        const strip: LEDStrip = {
          id: uid('strip'),
          name: `Segment ${s.strips.length + 1}`,
          deviceId: device.id,
          gpio,
          chipset: 'WS2812B',
          ledCount: Math.min(60, free),
          shape: 'line',
          start: [-1, 1, 0],
          end: [1, 1, 0],
          helixRadius: 0.4,
          helixTurns: 4,
          visible: true,
        };
        return { strips: [...s.strips, strip], selectedStripId: strip.id, selectedSensorId: null };
      }),
    removeStrip: (id: string) =>
      set((s) => ({
        strips: s.strips.filter((x) => x.id !== id),
        selectedStripId: s.selectedStripId === id ? null : s.selectedStripId,
      })),

    updateDevice: (id: string, patch: Partial<ESP32Device>) =>
      set((s) => ({ devices: s.devices.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),
    addDevice: (device: ESP32Device) => set((s) => ({ devices: [...s.devices, device] })),

    selectSensor: (selectedSensorId: string | null) => set({ selectedSensorId, selectedStripId: null }),
    addSensor: (kind: SensorKind) =>
      set((s) => {
        const n = s.sensors.filter((x) => x.kind === kind).length + 1;
        const scenario = SCENARIOS[kind][0]?.value ?? 'electro';
        const sensor: SensorNode = {
          id: uid(kind),
          name: `${KIND_META[kind].label} ${n}`,
          kind,
          deviceId: null,
          source: 'sim',
          position: [0, 1, 0],
          radius: 2,
          falloff: 'smooth',
          enabled: true,
          visible: true,
          bands: kind === 'audio' ? DEFAULT_BANDS.map((b) => ({ ...b })) : [],
          sim: sim({ mode: kind === 'gpio' ? 'manual' : 'auto', scenario }),
        };
        return { sensors: [...s.sensors, sensor], selectedSensorId: sensor.id, selectedStripId: null };
      }),
    updateSensor: (id: string, patch: Partial<SensorNode>) =>
      set((s) => ({ sensors: s.sensors.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
    /** Deleting a sensor also deletes the routes fed by its channels. */
    removeSensor: (id: string) =>
      set((s) => ({
        sensors: s.sensors.filter((x) => x.id !== id),
        routes: s.routes.filter((r) => sensorIdOf(r.source) !== id),
        selectedSensorId: s.selectedSensorId === id ? null : s.selectedSensorId,
      })),
    setSensorManual: (id: string, channelId: string, raw: number) =>
      set((s) => ({
        sensors: s.sensors.map((x) => (x.id === id ? { ...x, sim: { ...x.sim, manual: { ...x.sim.manual, [channelId]: raw } } } : x)),
      })),
    addBand: (sensorId: string) =>
      set((s) => ({
        sensors: s.sensors.map((x) =>
          x.id === sensorId
            ? {
                ...x,
                bands: [
                  ...x.bands,
                  { id: uid('band'), label: `Band ${x.bands.length + 1}`, lowHz: 150, highHz: 400, gain: 1.5, attackMs: 15, releaseMs: 180 },
                ],
              }
            : x,
        ),
      })),
    updateBand: (sensorId: string, bandId: string, patch: Partial<AudioBand>) =>
      set((s) => ({
        sensors: s.sensors.map((x) =>
          x.id === sensorId ? { ...x, bands: x.bands.map((b) => (b.id === bandId ? { ...b, ...patch } : b)) } : x,
        ),
      })),
    removeBand: (sensorId: string, bandId: string) =>
      set((s) => ({
        sensors: s.sensors.map((x) => (x.id === sensorId ? { ...x, bands: x.bands.filter((b) => b.id !== bandId) } : x)),
        routes: s.routes.filter((r) => r.source !== channelKey(sensorId, bandId)),
      })),

    selectRoute: (selectedRouteId: string | null) => set({ selectedRouteId }),
    addRoute: (init?: Partial<Omit<ModulationRoute, 'id'>>) =>
      set((s) => {
        const route: ModulationRoute = {
          source: allChannels(s.sensors)[0]?.key ?? '',
          target: 'master_brightness',
          curve: 'linear',
          amount: 0.5,
          bipolar: false,
          enabled: true,
          ...init,
          id: uid('route'),
        };
        return { routes: [...s.routes, route], selectedRouteId: route.id };
      }),
    updateRoute: (id: string, patch: Partial<ModulationRoute>) =>
      set((s) => ({ routes: s.routes.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
    removeRoute: (id: string) =>
      set((s) => ({
        routes: s.routes.filter((r) => r.id !== id),
        selectedRouteId: s.selectedRouteId === id ? null : s.selectedRouteId,
      })),
  };
}

export type VoxelActions = ReturnType<typeof createActions>;

interface Ctx {
  store: VoxelStore;
  actions: VoxelActions;
}

const VoxelContext = createContext<Ctx | null>(null);

export function VoxelProvider({ children }: { children: ReactNode }) {
  const ref = useRef<Ctx | null>(null);
  if (!ref.current) {
    const store = createVoxelStore();
    ref.current = { store, actions: createActions(store) };
  }
  return createElement(VoxelContext.Provider, { value: ref.current }, children);
}

function useCtx(): Ctx {
  const ctx = useContext(VoxelContext);
  if (!ctx) throw new Error('VoxelProvider is missing');
  return ctx;
}

/** Subscribe to a slice. The selector must return a stable reference (state field or primitive). */
export function useVoxel<T>(selector: (s: VoxelState) => T): T {
  const { store } = useCtx();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

/** Raw store access for animation loops: read with getState(), never re-renders. */
export function useVoxelStoreRef(): VoxelStore {
  return useCtx().store;
}

export function useVoxelActions(): VoxelActions {
  return useCtx().actions;
}
