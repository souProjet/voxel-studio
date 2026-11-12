import type { EffectLayer, EffectParams, ESP32Device, Generator, LEDStrip, ModulationRoute, PatchLayout, SensorNode } from '../types/voxel';
import { EFFECT_DEFAULTS } from './catalog';
import { LAYER_DEFAULTS, makeLayer } from './layers';
import { normalizeStrip } from './geometry';
import { normalizeGenerator, ROUTE_DEFAULTS } from './generators';
import type { VoxelStore } from '../state/useVoxelStore';
import { t } from '../i18n';

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
  generators: Generator[];
  /** Node positions in the modulation editor. */
  patchLayout: PatchLayout;
  /** Effect stack, bottom first. */
  layers: EffectLayer[];
  params: EffectParams;
  showRoom: boolean;
  showSphere: boolean;
}

interface ProjectFile extends ProjectData {
  format: typeof PROJECT_FORMAT;
  version: number;
  savedAt: string;
}

export const PROJECT_KEYS: (keyof ProjectData)[] = ['strips', 'devices', 'routes', 'sensors', 'generators', 'patchLayout', 'layers', 'params', 'showRoom', 'showSphere'];

export function pickProject(source: ProjectData): ProjectData {
  return {
    strips: source.strips,
    devices: source.devices,
    routes: source.routes,
    sensors: source.sensors,
    generators: source.generators,
    patchLayout: source.patchLayout,
    layers: source.layers,
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

/** Files from before layers had one built-in shader: it becomes a single layer running its GLSL port. */
const LEGACY_SHADERS: Record<string, string> = { spherical_wave: 'sphere', perlin_plasma: 'plasma', laser_plane: 'laser', height_spectrum: 'height' };
const legacyLayer = (shader: unknown) => makeLayer('layer-base', LEGACY_SHADERS[String(shader)] ?? 'sphere', 'Base');

/** Keeps only well-formed node positions; a broken layout falls back to the automatic one. */
function parseLayout(v: unknown): PatchLayout {
  if (!v || typeof v !== 'object' || isArray(v)) return {};
  const out: PatchLayout = {};
  for (const [id, p] of Object.entries(v as Record<string, { x?: unknown; y?: unknown }>)) {
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) out[id] = { x: p.x as number, y: p.y as number };
  }
  return out;
}

/** Parses and validates a project file. Throws a readable Error when the file cannot be used. */
export function parseProject(text: string): ProjectData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(t('Not a JSON file.'));
  }
  const f = raw as Partial<ProjectFile>;
  if (!f || typeof f !== 'object' || f.format !== PROJECT_FORMAT) throw new Error(t('Not a VOXEL // STUDIO project.'));
  if (typeof f.version !== 'number' || f.version > PROJECT_VERSION) {
    throw new Error(t('Project version {version} is newer than this app supports ({supported}).', { version: String(f.version), supported: PROJECT_VERSION }));
  }
  if (!isArray(f.strips) || !isArray(f.devices) || !isArray(f.routes) || !isArray(f.sensors)) {
    throw new Error(t('Project is missing strips, devices, routes or sensors.'));
  }
  for (const s of f.strips as LEDStrip[]) {
    if (typeof s.id !== 'string' || !isVec3(s.start) || !isVec3(s.end) || !(s.ledCount > 0)) {
      throw new Error(t('Invalid LED segment "{name}".', { name: String(s.name ?? s.id) }));
    }
  }
  for (const s of f.sensors as SensorNode[]) {
    if (typeof s.id !== 'string' || !isVec3(s.position)) throw new Error(t('Invalid sensor "{name}".', { name: String(s.name ?? s.id) }));
  }
  const p = f.params;
  if (!p || !isVec3(p.origin)) throw new Error(t('Project effect parameters are invalid.'));
  const layers = isArray(f.layers) ? (f.layers as EffectLayer[]) : [legacyLayer((f as { shader?: unknown }).shader)];
  for (const l of layers) {
    if (typeof l.id !== 'string' || typeof l.code !== 'string') throw new Error(t('Invalid layer "{name}".', { name: String(l.name ?? l.id) }));
  }
  const generators = isArray(f.generators) ? (f.generators as Generator[]) : [];
  for (const g of generators) {
    if (typeof g.id !== 'string' || !['lfo', 'envelope', 'macro', 'osc', 'midi'].includes(g.kind))
      throw new Error(t('Invalid generator "{name}".', { name: String(g.name ?? g.id) }));
  }
  // Files saved before newer fields existed get their defaults.
  return pickProject({
    ...(f as ProjectFile),
    params: { ...EFFECT_DEFAULTS, ...p },
    strips: (f.strips as LEDStrip[]).map(normalizeStrip),
    routes: (f.routes as ModulationRoute[]).map((r) => ({ ...ROUTE_DEFAULTS, ...r })),
    generators: generators.map(normalizeGenerator),
    patchLayout: parseLayout(f.patchLayout),
    layers: layers.map((l) => ({ ...LAYER_DEFAULTS, ...l })),
  });
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
      name: typeof entry.name === 'string' ? entry.name : t('Untitled'),
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
    const changed = PROJECT_KEYS.some((k) => s[k] !== prev[k]) || s.projectName !== prev.projectName || s.projectPath !== prev.projectPath || s.dirty !== prev.dirty;
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
