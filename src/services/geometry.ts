import type { ColorOrder, LEDStrip, LedChipset, Vec3 } from '../types/voxel';
import { MAX_LEDS } from './catalog';

/** Fields every strip needs beyond its identity; used for new strips and to upgrade older project files. */
export const STRIP_DEFAULTS = {
  helixRadius: 0.5,
  helixTurns: 6,
  visible: true,
  reversed: false,
  skipStart: 0,
  skipEnd: 0,
  gain: 1,
  colorOrder: 'RGB' as ColorOrder,
  points: [] as Vec3[],
  arcAxis: 'y' as const,
  arcStartDeg: 0,
  arcSweepDeg: 360,
  matrixCols: 16,
  matrixRows: 8,
  serpentine: true,
};

type StripCore = Pick<LEDStrip, 'id' | 'name' | 'deviceId' | 'gpio' | 'chipset' | 'ledCount' | 'shape' | 'start' | 'end'>;

export function normalizeStrip(s: StripCore & Partial<LEDStrip>): LEDStrip {
  return { ...STRIP_DEFAULTS, ...s };
}

export interface StripRange {
  stripId: string;
  deviceId: string;
  chipset: LedChipset;
  /** Global index of the first LED in the shared buffers. */
  start: number;
  count: number;
  visible: boolean;
  gain: number;
  colorOrder: ColorOrder;
}

export interface LedLayout {
  /** xyz per LED, MAX_LEDS * 3. */
  positions: Float32Array;
  /** Range index per LED, -1 when unused. */
  rangeOf: Int32Array;
  /** 1 for skipped LEDs: present on the wire, always dark, hidden in the viewport. */
  dark: Uint8Array;
  ranges: StripRange[];
  total: number;
}

export const activeCount = (s: LEDStrip) => Math.max(0, s.ledCount - s.skipStart - s.skipEnd);

/** Polyline vertices: explicit points when there are at least two, else the start -> end segment. */
export const polylineVertices = (s: LEDStrip): Vec3[] => (s.points.length >= 2 ? s.points : [s.start, s.end]);

/** Positions of the active LEDs, in path order (before reversal). */
function shapePositions(s: LEDStrip, n: number): Float32Array {
  const out = new Float32Array(n * 3);
  const put = (i: number, x: number, y: number, z: number) => {
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  };
  const tOf = (i: number) => (n > 1 ? i / (n - 1) : 0.5);
  const [sx, sy, sz] = s.start;
  const ax = s.end[0] - sx, ay = s.end[1] - sy, az = s.end[2] - sz;

  switch (s.shape) {
    case 'line':
      for (let i = 0; i < n; i++) {
        const t = tOf(i);
        put(i, sx + ax * t, sy + ay * t, sz + az * t);
      }
      break;

    case 'helix': {
      const len = Math.hypot(ax, ay, az) || 1;
      const dx = ax / len, dy = ay / len, dz = az / len;
      const [rx, ry, rz] = Math.abs(dy) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      let ux = dy * rz - dz * ry, uy = dz * rx - dx * rz, uz = dx * ry - dy * rx;
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul; uy /= ul; uz /= ul;
      const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
      for (let i = 0; i < n; i++) {
        const t = tOf(i);
        const a = t * s.helixTurns * Math.PI * 2;
        const c = Math.cos(a) * s.helixRadius, si = Math.sin(a) * s.helixRadius;
        put(i, sx + ax * t + ux * c + vx * si, sy + ay * t + uy * c + vy * si, sz + az * t + uz * c + vz * si);
      }
      break;
    }

    case 'polyline': {
      const v = polylineVertices(s);
      const seg: number[] = [];
      let total = 0;
      for (let k = 1; k < v.length; k++) {
        const l = Math.hypot(v[k][0] - v[k - 1][0], v[k][1] - v[k - 1][1], v[k][2] - v[k - 1][2]);
        seg.push(l);
        total += l;
      }
      let k = 0;
      let acc = 0;
      for (let i = 0; i < n; i++) {
        const target = tOf(i) * total;
        while (k < seg.length - 1 && acc + seg[k] < target) acc += seg[k++];
        const f = seg[k] > 0 ? Math.min(1, (target - acc) / seg[k]) : 0;
        const p = v[k], q = v[k + 1];
        put(i, p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f);
      }
      break;
    }

    case 'arc': {
      const full = Math.abs(s.arcSweepDeg) >= 360;
      const r = s.helixRadius;
      for (let i = 0; i < n; i++) {
        const t = full ? i / Math.max(n, 1) : tOf(i);
        const a = ((s.arcStartDeg + t * s.arcSweepDeg) * Math.PI) / 180;
        const c = Math.cos(a) * r, si = Math.sin(a) * r;
        if (s.arcAxis === 'y') put(i, sx + c, sy, sz + si);
        else if (s.arcAxis === 'x') put(i, sx, sy + c, sz + si);
        else put(i, sx + c, sy + si, sz);
      }
      break;
    }

    case 'matrix': {
      // Flat panel when both corners share Y (columns along X, rows along Z); otherwise
      // vertical (columns along the horizontal run, rows along Y).
      const flat = Math.abs(ay) < 1e-6;
      const u: Vec3 = flat ? [ax, 0, 0] : [ax, 0, az];
      const w: Vec3 = flat ? [0, 0, az] : [0, ay, 0];
      const cols = Math.max(1, s.matrixCols), rows = Math.max(1, s.matrixRows);
      for (let i = 0; i < n; i++) {
        const row = Math.floor(i / cols);
        let col = i % cols;
        if (s.serpentine && row % 2 === 1) col = cols - 1 - col;
        const fu = cols > 1 ? col / (cols - 1) : 0.5;
        const fw = rows > 1 ? row / (rows - 1) : 0.5;
        put(i, sx + u[0] * fu + w[0] * fw, sy + u[1] * fu + w[1] * fw, sz + u[2] * fu + w[2] * fw);
      }
      break;
    }

    case 'points': {
      for (let i = 0; i < n; i++) {
        const p = s.points[Math.min(i, s.points.length - 1)] ?? s.start;
        put(i, p[0], p[1], p[2]);
      }
      break;
    }
  }
  return out;
}

/**
 * Writes every physical LED of a strip (skipped ones included) starting at index `at`.
 * Skipped LEDs sit on the path ends and are flagged dark.
 */
export function writeStripPositions(strip: LEDStrip, out: Float32Array, dark: Uint8Array, at: number, count = strip.ledCount): void {
  const n = activeCount(strip);
  const act = shapePositions(strip, Math.max(n, 1));
  for (let j = 0; j < count; j++) {
    const a = j - strip.skipStart;
    const skipped = a < 0 || a >= n;
    const pathIndex = skipped ? (a < 0 ? 0 : Math.max(n - 1, 0)) : a;
    const idx = strip.reversed ? Math.max(n - 1, 0) - pathIndex : pathIndex;
    const k = (at + j) * 3;
    out[k] = act[idx * 3];
    out[k + 1] = act[idx * 3 + 1];
    out[k + 2] = act[idx * 3 + 2];
    dark[at + j] = skipped ? 1 : 0;
  }
}

export function buildLayout(strips: LEDStrip[]): LedLayout {
  const positions = new Float32Array(MAX_LEDS * 3);
  const rangeOf = new Int32Array(MAX_LEDS).fill(-1);
  const dark = new Uint8Array(MAX_LEDS);
  const ranges: StripRange[] = [];
  let cursor = 0;
  for (const strip of strips) {
    const count = Math.min(strip.ledCount, MAX_LEDS - cursor);
    if (count <= 0) break;
    writeStripPositions(strip, positions, dark, cursor, count);
    rangeOf.fill(ranges.length, cursor, cursor + count);
    ranges.push({
      stripId: strip.id,
      deviceId: strip.deviceId,
      chipset: strip.chipset,
      start: cursor,
      count,
      visible: strip.visible,
      gain: strip.gain,
      colorOrder: strip.colorOrder,
    });
    cursor += count;
  }
  return { positions, rangeOf, dark, ranges, total: cursor };
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const pathLength = (v: Vec3[]) => v.reduce((sum, p, i) => (i ? sum + dist(v[i - 1], p) : 0), 0);

/** Physical length of the mapped path in meters (matrix: total run along its rows). */
export function stripLength(s: LEDStrip): number {
  const axial = dist(s.start, s.end);
  switch (s.shape) {
    case 'line':
      return axial;
    case 'helix':
      return Math.hypot(axial, s.helixTurns * Math.PI * 2 * s.helixRadius);
    case 'polyline':
      return pathLength(polylineVertices(s));
    case 'arc':
      return (Math.abs(s.arcSweepDeg) * Math.PI * s.helixRadius) / 180;
    case 'matrix': {
      const flat = Math.abs(s.end[1] - s.start[1]) < 1e-6;
      const run = flat ? Math.abs(s.end[0] - s.start[0]) : Math.hypot(s.end[0] - s.start[0], s.end[2] - s.start[2]);
      return run * Math.max(1, s.matrixRows);
    }
    case 'points':
      return pathLength(s.points);
  }
}

/** Byte permutation for each wire color order: output byte i takes input channel ORDER[i]. */
export const COLOR_ORDER_INDEX: Record<ColorOrder, [number, number, number]> = {
  RGB: [0, 1, 2],
  GRB: [1, 0, 2],
  BRG: [2, 0, 1],
  RBG: [0, 2, 1],
  GBR: [1, 2, 0],
  BGR: [2, 1, 0],
};

export const vecEq = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
