import { createContext, createElement, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import type {
  AudioBand,
  DeviceHealth,
  EffectParams,
  EngineStats,
  ESP32Device,
  Generator,
  GeneratorKind,
  LEDStrip,
  ModulationRoute,
  NodePos,
  Notice,
  PatchLayout,
  ScanState,
  SensorKind,
  SensorNode,
  ShaderId,
  StripShape,
  TestPattern,
  Vec3,
  ViewId,
} from '../types/voxel';
import { t, tk } from '../i18n';
import { EFFECT_DEFAULTS, KIND_META, MAX_LEDS, SCENARIOS } from '../services/catalog';
import { channelKey, sensorIdOf } from '../services/sensors';
import { loadAutosave, pickProject, PROJECT_KEYS, type ProjectData } from '../services/project';
import { normalizeStrip } from '../services/geometry';
import { GENERATOR_META, modChannels, normalizeGenerator, ROUTE_DEFAULTS } from '../services/generators';

export interface VoxelState {
  view: ViewId;
  strips: LEDStrip[];
  devices: ESP32Device[];
  routes: ModulationRoute[];
  sensors: SensorNode[];
  generators: Generator[];
  patchLayout: PatchLayout;
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
  /** Outputs black on every LED while still streaming, so controllers stay in realtime mode. */
  blackout: boolean;
  projectName: string;
  /** Native file path of the open project; null in the browser or before the first save. */
  projectPath: string | null;
  /** Project data changed since the last save or open. */
  dirty: boolean;
  health: Record<string, DeviceHealth>;
  notice: Notice | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Installation test patterns per device (transient, never saved). */
  testPatterns: Record<string, TestPattern>;
  /** Blinks one segment so it can be found on site, until `until` (performance.now ms). */
  identify: { stripId: string; until: number } | null;
}

type Update = Partial<VoxelState> | ((s: VoxelState) => Partial<VoxelState>);

export interface SetOptions {
  /** Live-control changes (held buttons, manual sensor values): no undo entry, no unsaved flag. */
  transient?: boolean;
  /** Replaces the project wholesale (open, new): clears undo history. */
  resetHistory?: boolean;
}

/**
 * Minimal external store. React components subscribe through selectors (useSyncExternalStore),
 * while the 60 FPS render loop reads `store.getState()` directly: the "synchronized ref" that
 * never triggers a React render.
 */
export interface VoxelStore {
  getState(): VoxelState;
  setState(update: Update, options?: SetOptions): void;
  subscribe(listener: () => void): () => void;
  undo(): void;
  redo(): void;
}

const HISTORY_LIMIT = 100;
/** Edits closer together than this (a scrub, a drag) collapse into one undo step. */
const COALESCE_MS = 400;

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

const INITIAL_STRIPS: LEDStrip[] = (
  [
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
  ] as const satisfies Parameters<typeof normalizeStrip>[0][]
).map((x) => normalizeStrip({ ...x, start: [...x.start], end: [...x.end] }));

const sim = (patch: Partial<SensorNode['sim']> = {}): SensorNode['sim'] => ({
  mode: 'auto',
  scenario: 'electro',
  bpm: 124,
  manual: {},
  ...patch,
});

const DEFAULT_BANDS: AudioBand[] = [
  { id: 'bass', label: 'Sub', lowHz: 40, highHz: 90, gain: 1.4, attackMs: 8, releaseMs: 140 },
  { id: 'mid', label: tk('Mid'), lowHz: 300, highHz: 2000, gain: 2.2, attackMs: 20, releaseMs: 220 },
  { id: 'high', label: tk('High'), lowHz: 4000, highHz: 12000, gain: 1.6, attackMs: 4, releaseMs: 90 },
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

const INITIAL_ROUTES: ModulationRoute[] = (
  [
    { id: 'route-bass', source: 'mic-salon.bass', target: 'sphere_radius', curve: 'exp', amount: 0.85, bipolar: false, enabled: true },
    { id: 'route-gps', source: 'gps-neo.speed', target: 'shader_speed', curve: 'linear', amount: 0.65, bipolar: false, enabled: true },
    { id: 'route-high', source: 'mic-salon.high', target: 'color_shift', curve: 'scurve', amount: 0.45, bipolar: true, enabled: true },
    { id: 'route-btn', source: 'btn-18.pressed', target: 'strobe_override', curve: 'step', amount: 1, bipolar: false, enabled: true },
    { id: 'route-wave', source: 'mic-salon.bass', target: 'local_wave', curve: 'linear', amount: 1, bipolar: false, enabled: true },
    { id: 'route-local', source: 'mic-salon.mid', target: 'local_intensity', curve: 'scurve', amount: 0.6, bipolar: false, enabled: true },
  ] as Omit<ModulationRoute, keyof typeof ROUTE_DEFAULTS>[]
).map((r) => ({ ...ROUTE_DEFAULTS, ...r }));

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

export function defaultProject(): ProjectData {
  return {
    strips: INITIAL_STRIPS,
    devices: INITIAL_DEVICES,
    routes: INITIAL_ROUTES,
    sensors: INITIAL_SENSORS,
    generators: [],
    patchLayout: {},
    shader: 'spherical_wave',
    params: { origin: [0, 1.2, 0], radius: 1.4, speed: 1, hueShift: 0, masterBrightness: 0.8, ...EFFECT_DEFAULTS },
    showRoom: true,
    showSphere: true,
  };
}

/** Restores the autosaved project when there is one (crash or reload recovery). */
function initialState(): VoxelState {
  const saved = loadAutosave();
  return {
    view: 'studio',
    ...(saved?.data ?? defaultProject()),
    sensorValues: {},
    selectedStripId: saved ? null : 'strip-helix',
    selectedSensorId: null,
    selectedRouteId: saved ? null : 'route-bass',
    ddpOutput: true,
    manualStrobe: false,
    scan: { active: false, bit: 0 },
    stats: EMPTY_STATS,
    blackout: false,
    projectName: saved?.name ?? t('Untitled'),
    projectPath: saved?.path ?? null,
    dirty: saved?.dirty ?? false,
    health: {},
    notice: null,
    canUndo: false,
    canRedo: false,
    testPatterns: {},
    identify: null,
  };
}

/** Tap-tempo timestamps (ms), shared by the button and the T shortcut. */
const taps: number[] = [];

export function createVoxelStore(): VoxelStore {
  let state = initialState();
  const listeners = new Set<() => void>();
  let past: ProjectData[] = [];
  let future: ProjectData[] = [];
  let lastEditAt = 0;
  const emit = () => listeners.forEach((l) => l());

  const restore = (snapshot: ProjectData) => {
    state = { ...state, ...snapshot, dirty: true, canUndo: past.length > 0, canRedo: future.length > 0 };
    lastEditAt = 0;
    emit();
  };

  return {
    getState: () => state,
    setState(update, options = {}) {
      const patch = typeof update === 'function' ? update(state) : update;
      const prev = state;
      state = { ...state, ...patch };
      if (options.resetHistory) {
        past = [];
        future = [];
        state.canUndo = state.canRedo = false;
      } else if (!options.transient && PROJECT_KEYS.some((k) => state[k] !== prev[k])) {
        if (!('dirty' in patch)) state.dirty = true;
        const now = performance.now();
        if (now - lastEditAt > COALESCE_MS) {
          past.push(pickProject(prev));
          if (past.length > HISTORY_LIMIT) past.shift();
        }
        lastEditAt = now;
        future = [];
        state.canUndo = past.length > 0;
        state.canRedo = false;
      }
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    undo() {
      const snapshot = past.pop();
      if (!snapshot) return;
      future.push(pickProject(state));
      restore(snapshot);
    },
    redo() {
      const snapshot = future.pop();
      if (!snapshot) return;
      past.push(pickProject(state));
      restore(snapshot);
    },
  };
}

export const totalLeds = (strips: LEDStrip[]) => strips.reduce((n, s) => n + s.ledCount, 0);

/** Removes routes fed by matching channels and clears references to them elsewhere. */
function dropSource(s: VoxelState, gone: (key: string) => boolean): Pick<VoxelState, 'routes' | 'generators'> {
  return {
    routes: s.routes.filter((r) => !gone(r.source)).map((r) => (r.amountSource && gone(r.amountSource) ? { ...r, amountSource: null } : r)),
    generators: s.generators.map((g) => (g.trigger && gone(g.trigger) ? { ...g, trigger: null } : g)),
  };
}

function createActions(store: VoxelStore) {
  const set = store.setState;
  return {
    setView: (view: ViewId) => set({ view }),
    setShader: (shader: ShaderId) => set({ shader }),
    setParams: (patch: Partial<EffectParams>) => set((s) => ({ params: { ...s.params, ...patch } })),
    /** Tap tempo: averages the last taps; a pause over 2 s starts a new measure. */
    tapTempo: () => {
      const now = performance.now();
      if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
      taps.push(now);
      if (taps.length > 5) taps.shift();
      if (taps.length < 2) return;
      const bpm = (60000 * (taps.length - 1)) / (taps[taps.length - 1] - taps[0]);
      set((s) => ({ params: { ...s.params, bpm: Math.round(Math.min(300, Math.max(30, bpm)) * 10) / 10 } }));
    },
    setOriginAxis: (axis: 0 | 1 | 2, value: number) =>
      set((s) => {
        const origin = [...s.params.origin] as Vec3;
        origin[axis] = value;
        return { params: { ...s.params, origin } };
      }),
    setManualStrobe: (manualStrobe: boolean) => set({ manualStrobe }),
    setBlackout: (blackout: boolean) => set({ blackout }),
    /** Kills every momentary or risky state at once: blackout on, strobe and scan off, buttons released. */
    panic: () =>
      set(
        (s) => ({
          blackout: true,
          manualStrobe: false,
          scan: { ...s.scan, active: false },
          testPatterns: {},
          identify: null,
          sensors: s.sensors.map((x) => (x.kind === 'gpio' ? { ...x, sim: { ...x.sim, manual: { ...x.sim.manual, pressed: 0 } } } : x)),
        }),
        { transient: true },
      ),
    undo: () => store.undo(),
    redo: () => store.redo(),
    setTestPattern: (deviceId: string, pattern: TestPattern) => set((s) => ({ testPatterns: { ...s.testPatterns, [deviceId]: pattern } })),
    identifyStrip: (stripId: string) => set({ identify: { stripId, until: performance.now() + 4000 } }),

    newProject: () =>
      set(
        {
          ...defaultProject(),
          projectName: t('Untitled'),
          projectPath: null,
          dirty: false,
          selectedStripId: null,
          selectedSensorId: null,
          selectedRouteId: null,
          sensorValues: {},
        },
        { resetHistory: true },
      ),
    loadProject: (data: ProjectData, name: string, path: string | null) =>
      set(
        {
          ...data,
          projectName: name,
          projectPath: path,
          dirty: false,
          selectedStripId: null,
          selectedSensorId: null,
          selectedRouteId: null,
          sensorValues: {},
        },
        { resetHistory: true },
      ),
    markSaved: (name: string, path: string | null) => set({ projectName: name, projectPath: path, dirty: false }),
    setHealth: (id: string, health: DeviceHealth) => set((s) => ({ health: { ...s.health, [id]: health } })),
    notify: (text: string, tone: Notice['tone'] = 'info') => set({ notice: { id: Date.now(), text, tone } }),
    dismissNotice: () => set({ notice: null }),
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
          next.skipStart = Math.max(0, Math.min(Math.round(next.skipStart), next.ledCount - 1));
          next.skipEnd = Math.max(0, Math.min(Math.round(next.skipEnd), next.ledCount - 1 - next.skipStart));
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
        const strip = normalizeStrip({
          id: uid('strip'),
          name: `Segment ${s.strips.length + 1}`,
          deviceId: device.id,
          gpio,
          chipset: 'WS2812B',
          ledCount: Math.min(60, free),
          shape: 'line',
          start: [-1, 1, 0],
          end: [1, 1, 0],
        });
        return { strips: [...s.strips, strip], selectedStripId: strip.id, selectedSensorId: null };
      }),
    duplicateStrip: (id: string) =>
      set((s) => {
        const i = s.strips.findIndex((x) => x.id === id);
        const free = MAX_LEDS - totalLeds(s.strips);
        if (i < 0 || free <= 0) return {};
        const src = s.strips[i];
        const shift = (v: Vec3): Vec3 => [v[0], v[1], +(v[2] + 0.15).toFixed(3)];
        const copy: LEDStrip = {
          ...src,
          id: uid('strip'),
          name: t('{name} copy', { name: src.name }),
          ledCount: Math.min(src.ledCount, free),
          start: shift(src.start),
          end: shift(src.end),
          points: src.points.map(shift),
        };
        return { strips: [...s.strips.slice(0, i + 1), copy, ...s.strips.slice(i + 1)], selectedStripId: copy.id, selectedSensorId: null };
      }),
    /** Moves a segment one slot earlier or later in its controller's pixel buffer. */
    moveStrip: (id: string, dir: -1 | 1) =>
      set((s) => {
        const i = s.strips.findIndex((x) => x.id === id);
        if (i < 0) return {};
        let j = i + dir;
        while (j >= 0 && j < s.strips.length && s.strips[j].deviceId !== s.strips[i].deviceId) j += dir;
        if (j < 0 || j >= s.strips.length) return {};
        const strips = [...s.strips];
        [strips[i], strips[j]] = [strips[j], strips[i]];
        return { strips };
      }),
    /** Changes shape and seeds the fields the new shape needs from the current geometry. */
    setStripShape: (id: string, shape: StripShape) =>
      set((s) => ({
        strips: s.strips.map((x) => {
          if (x.id !== id) return x;
          const next: LEDStrip = { ...x, shape };
          if (shape === 'polyline' && x.points.length < 2) next.points = [x.start, x.end];
          if (shape === 'matrix') next.ledCount = next.matrixCols * next.matrixRows + x.skipStart + x.skipEnd;
          if (shape === 'points' && x.points.length === 0) next.points = [x.start, x.end];
          return next;
        }),
      })),
    /** Matrix size drives the LED count. */
    setMatrix: (id: string, patch: Partial<Pick<LEDStrip, 'matrixCols' | 'matrixRows' | 'serpentine'>>) =>
      set((s) => {
        const others = s.strips.reduce((n, x) => (x.id === id ? n : n + x.ledCount), 0);
        return {
          strips: s.strips.map((x) => {
            if (x.id !== id) return x;
            const next = { ...x, ...patch };
            next.matrixCols = Math.max(1, Math.round(next.matrixCols));
            next.matrixRows = Math.max(1, Math.round(next.matrixRows));
            const wanted = next.matrixCols * next.matrixRows + x.skipStart + x.skipEnd;
            if (others + wanted > MAX_LEDS) return x;
            next.ledCount = wanted;
            return next;
          }),
        };
      }),
    addPointsStrip: (name: string, points: Vec3[], deviceId: string) =>
      set((s) => {
        const free = MAX_LEDS - totalLeds(s.strips);
        const pts = points.slice(0, Math.max(0, free));
        if (pts.length === 0) return {};
        const strip = normalizeStrip({
          id: uid('strip'),
          name,
          deviceId,
          gpio: 0,
          chipset: 'WS2812B',
          ledCount: pts.length,
          shape: 'points',
          start: pts[0],
          end: pts[pts.length - 1],
          points: pts,
        });
        return { strips: [...s.strips, strip], selectedStripId: strip.id, selectedSensorId: null };
      }),
    removeStrip: (id: string) =>
      set((s) => ({
        strips: s.strips.filter((x) => x.id !== id),
        selectedStripId: s.selectedStripId === id ? null : s.selectedStripId,
      })),

    updateDevice: (id: string, patch: Partial<ESP32Device>) => set((s) => ({ devices: s.devices.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),
    addDevice: (device: ESP32Device) => set((s) => ({ devices: [...s.devices, device] })),
    /** Refuses while segments still output through the device; hosted sensors become unhosted. */
    removeDevice: (id: string): boolean => {
      const st = store.getState();
      if (st.strips.some((x) => x.deviceId === id)) return false;
      set((s) => ({
        devices: s.devices.filter((d) => d.id !== id),
        sensors: s.sensors.map((x) => (x.deviceId === id ? { ...x, deviceId: null } : x)),
      }));
      return true;
    },

    selectSensor: (selectedSensorId: string | null) => set({ selectedSensorId, selectedStripId: null }),
    addSensor: (kind: SensorKind) =>
      set((s) => {
        const n = s.sensors.filter((x) => x.kind === kind).length + 1;
        const scenario = SCENARIOS[kind][0]?.value ?? 'electro';
        const sensor: SensorNode = {
          id: uid(kind),
          name: `${t(KIND_META[kind].label)} ${n}`,
          kind,
          deviceId: null,
          source: 'sim',
          position: [0, 1, 0],
          radius: 2,
          falloff: 'smooth',
          enabled: true,
          visible: true,
          bands: kind === 'audio' ? DEFAULT_BANDS.map((b) => ({ ...b, label: t(b.label) })) : [],
          sim: sim({ mode: kind === 'gpio' ? 'manual' : 'auto', scenario }),
        };
        return { sensors: [...s.sensors, sensor], selectedSensorId: sensor.id, selectedStripId: null };
      }),
    updateSensor: (id: string, patch: Partial<SensorNode>) => set((s) => ({ sensors: s.sensors.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
    /** Deleting a sensor also deletes the routes fed by its channels. */
    removeSensor: (id: string) =>
      set((s) => ({
        sensors: s.sensors.filter((x) => x.id !== id),
        ...dropSource(s, (key) => sensorIdOf(key) === id),
        selectedSensorId: s.selectedSensorId === id ? null : s.selectedSensorId,
      })),
    setSensorManual: (id: string, channelId: string, raw: number) =>
      set(
        (s) => ({
          sensors: s.sensors.map((x) => (x.id === id ? { ...x, sim: { ...x.sim, manual: { ...x.sim.manual, [channelId]: raw } } } : x)),
        }),
        { transient: true },
      ),
    addBand: (sensorId: string) =>
      set((s) => ({
        sensors: s.sensors.map((x) =>
          x.id === sensorId
            ? {
                ...x,
                bands: [...x.bands, { id: uid('band'), label: t('Band {n}', { n: x.bands.length + 1 }), lowHz: 150, highHz: 400, gain: 1.5, attackMs: 15, releaseMs: 180 }],
              }
            : x,
        ),
      })),
    updateBand: (sensorId: string, bandId: string, patch: Partial<AudioBand>) =>
      set((s) => ({
        sensors: s.sensors.map((x) => (x.id === sensorId ? { ...x, bands: x.bands.map((b) => (b.id === bandId ? { ...b, ...patch } : b)) } : x)),
      })),
    removeBand: (sensorId: string, bandId: string) =>
      set((s) => ({
        sensors: s.sensors.map((x) => (x.id === sensorId ? { ...x, bands: x.bands.filter((b) => b.id !== bandId) } : x)),
        ...dropSource(s, (key) => key === channelKey(sensorId, bandId)),
      })),

    /** Adds a generator, optionally at a position in the modulation editor. Returns its id. */
    addGenerator: (kind: GeneratorKind, at?: NodePos) => {
      const id = uid(kind);
      set((s) => {
        const n = s.generators.filter((g) => g.kind === kind).length + 1;
        return {
          generators: [...s.generators, normalizeGenerator({ id, name: `${t(GENERATOR_META[kind].label)} ${n}`, kind })],
          ...(at && { patchLayout: { ...s.patchLayout, [id]: at } }),
        };
      });
      return id;
    },
    moveNodes: (positions: PatchLayout) => set((s) => ({ patchLayout: { ...s.patchLayout, ...positions } })),
    updateGenerator: (id: string, patch: Partial<Generator>) => set((s) => ({ generators: s.generators.map((g) => (g.id === id ? { ...g, ...patch } : g)) })),
    /** Live knob moves: no undo entry per step. */
    setMacro: (id: string, value: number) => set((s) => ({ generators: s.generators.map((g) => (g.id === id ? { ...g, value } : g)) }), { transient: true }),
    removeGenerator: (id: string) =>
      set((s) => {
        const { [id]: _gone, ...patchLayout } = s.patchLayout;
        const rest = { ...s, generators: s.generators.filter((g) => g.id !== id) };
        return { patchLayout, ...dropSource(rest, (key) => sensorIdOf(key) === id) };
      }),

    selectRoute: (selectedRouteId: string | null) => set({ selectedRouteId }),
    addRoute: (init?: Partial<Omit<ModulationRoute, 'id'>>) =>
      set((s) => {
        const route: ModulationRoute = {
          ...ROUTE_DEFAULTS,
          source: modChannels(s.sensors, s.generators)[0]?.key ?? '',
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
    updateRoute: (id: string, patch: Partial<ModulationRoute>) => set((s) => ({ routes: s.routes.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
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
  const [ctx] = useState<Ctx>(() => {
    const store = createVoxelStore();
    return { store, actions: createActions(store) };
  });
  return createElement(VoxelContext.Provider, { value: ctx }, children);
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
