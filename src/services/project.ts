import type { EffectParams, ESP32Device, LEDStrip, ModulationRoute, SensorNode, ShaderId } from '../types/voxel';
import { EFFECT_DEFAULTS, SHADER_PRESETS } from './catalog';
import { normalizeStrip } from './geometry';
import type { VoxelStore } from '../state/useVoxelStore';

export const PROJECT_FORMAT = 'voxel-studio';
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = 'voxel.json';
const AUTOSAVE_KEY = 'voxel-studio:autosave';

/** Everything that defines a show. Runtime-only state (stats, selection, sensor values) is excluded. */
export interface ProjectData {
  strips: LEDStrip[];
  devices: ESP32Device[];
  routes: ModulationRoute[];
  sensors: SensorNode[];
  shader: ShaderId;
  params: EffectParams;
  showRoom: boolean;
  showSphere: boolean;
}

interface ProjectFile extends ProjectData {
  format: typeof PROJECT_FORMAT;
  version: number;
  savedAt: string;
}

export const PROJECT_KEYS: (keyof ProjectData)[] = ['strips', 'devices', 'routes', 'sensors', 'shader', 'params', 'showRoom', 'showSphere'];

export function pickProject(source: ProjectData): ProjectData {
  return {
    strips: source.strips,
    devices: source.devices,
    routes: source.routes,
    sensors: source.sensors,
    shader: source.shader,
    params: source.params,
    showRoom: source.showRoom,
    showSphere: source.showSphere,
  };
}

export function serializeProject(data: ProjectData): string {
  const file: ProjectFile = { format: PROJECT_FORMAT, version: PROJECT_VERSION, savedAt: new Date().toISOString(), ...pickProject(data) };
  return JSON.stringify(file, null, 2);
}

const isArray = (v: unknown): v is unknown[] => Array.isArray(v);
const isVec3 = (v: unknown) => isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Parses and validates a project file. Throws a readable Error when the file cannot be used. */
export function parseProject(text: string): ProjectData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Not a JSON file.');
  }
  const f = raw as Partial<ProjectFile>;
  if (!f || typeof f !== 'object' || f.format !== PROJECT_FORMAT) throw new Error('Not a VOXEL // STUDIO project.');
  if (typeof f.version !== 'number' || f.version > PROJECT_VERSION) {
    throw new Error(`Project version ${String(f.version)} is newer than this app supports (${PROJECT_VERSION}).`);
  }
  if (!isArray(f.strips) || !isArray(f.devices) || !isArray(f.routes) || !isArray(f.sensors)) {
    throw new Error('Project is missing strips, devices, routes or sensors.');
  }
  for (const s of f.strips as LEDStrip[]) {
    if (typeof s.id !== 'string' || !isVec3(s.start) || !isVec3(s.end) || !(s.ledCount > 0)) {
      throw new Error(`Invalid LED segment "${String(s.name ?? s.id)}".`);
    }
  }
  for (const s of f.sensors as SensorNode[]) {
    if (typeof s.id !== 'string' || !isVec3(s.position)) throw new Error(`Invalid sensor "${String(s.name ?? s.id)}".`);
  }
  const p = f.params;
  if (!p || !isVec3(p.origin)) throw new Error('Project effect parameters are invalid.');
  if (!SHADER_PRESETS.some((x) => x.id === f.shader)) throw new Error(`Unknown shader "${String(f.shader)}".`);
  // Files saved before newer strip fields existed get their defaults.
  return pickProject({ ...(f as ProjectFile), params: { ...EFFECT_DEFAULTS, ...p }, strips: (f.strips as LEDStrip[]).map(normalizeStrip) });
}

export interface AutosaveEntry {
  data: ProjectData;
  name: string;
  path: string | null;
  dirty: boolean;
}

/** Browser storage can be unavailable (private mode, blocked site data): every access is guarded. */
export function loadAutosave(): AutosaveEntry | null {
  try {
    const text = localStorage.getItem(AUTOSAVE_KEY);
    if (!text) return null;
    const entry = JSON.parse(text) as { name?: unknown; path?: unknown; dirty?: unknown; file?: unknown };
    if (typeof entry.file !== 'string') return null;
    return {
      data: parseProject(entry.file),
      name: typeof entry.name === 'string' ? entry.name : 'Untitled',
      path: typeof entry.path === 'string' ? entry.path : null,
      dirty: entry.dirty === true,
    };
  } catch {
    return null;
  }
}

function writeAutosave(entry: AutosaveEntry): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ name: entry.name, path: entry.path, dirty: entry.dirty, file: serializeProject(entry.data) }));
  } catch {
    // Storage full or blocked: the show keeps running, only crash recovery is lost.
  }
}

/** Mirrors the project to browser storage 600 ms after the last change. */
export function startAutosave(store: VoxelStore): () => void {
  let timer = 0;
  let prev = store.getState();
  const unsubscribe = store.subscribe(() => {
    const s = store.getState();
    const changed =
      PROJECT_KEYS.some((k) => s[k] !== prev[k]) || s.projectName !== prev.projectName || s.projectPath !== prev.projectPath || s.dirty !== prev.dirty;
    prev = s;
    if (!changed) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const cur = store.getState();
      writeAutosave({ data: pickProject(cur), name: cur.projectName, path: cur.projectPath, dirty: cur.dirty });
    }, 600);
  });
  return () => {
    window.clearTimeout(timer);
    unsubscribe();
  };
}
