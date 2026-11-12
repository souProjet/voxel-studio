import type { LEDStrip, LedChipset, Vec3 } from '../types/voxel';
import { MAX_LEDS } from './catalog';

export interface StripRange {
  stripId: string;
  deviceId: string;
  chipset: LedChipset;
  /** Global index of the first LED in the shared buffers. */
  start: number;
  count: number;
  visible: boolean;
}

export interface LedLayout {
  /** xyz per LED, MAX_LEDS * 3. */
  positions: Float32Array;
  /** Range index per LED, -1 when unused. */
  rangeOf: Int32Array;
  ranges: StripRange[];
  total: number;
}

/** Writes the LED positions of a strip into out starting at LED index `at`. */
export function writeStripPositions(strip: LEDStrip, out: Float32Array, at: number): void {
  const [sx, sy, sz] = strip.start;
  const ax = strip.end[0] - sx;
  const ay = strip.end[1] - sy;
  const az = strip.end[2] - sz;
  const n = strip.ledCount;

  if (strip.shape === 'line') {
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0.5;
      const k = (at + i) * 3;
      out[k] = sx + ax * t;
      out[k + 1] = sy + ay * t;
      out[k + 2] = sz + az * t;
    }
    return;
  }

  // Helix around the start -> end axis.
  const len = Math.hypot(ax, ay, az) || 1;
  const dx = ax / len, dy = ay / len, dz = az / len;
  const [rx, ry, rz] = Math.abs(dy) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  // u = normalize(dir x ref), v = dir x u
  let ux = dy * rz - dz * ry, uy = dz * rx - dx * rz, uz = dx * ry - dy * rx;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
  const r = strip.helixRadius;
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0.5;
    const a = t * strip.helixTurns * Math.PI * 2;
    const c = Math.cos(a) * r, s = Math.sin(a) * r;
    const k = (at + i) * 3;
    out[k] = sx + ax * t + ux * c + vx * s;
    out[k + 1] = sy + ay * t + uy * c + vy * s;
    out[k + 2] = sz + az * t + uz * c + vz * s;
  }
}

export function buildLayout(strips: LEDStrip[]): LedLayout {
  const positions = new Float32Array(MAX_LEDS * 3);
  const rangeOf = new Int32Array(MAX_LEDS).fill(-1);
  const ranges: StripRange[] = [];
  let cursor = 0;
  for (const strip of strips) {
    const count = Math.min(strip.ledCount, MAX_LEDS - cursor);
    if (count <= 0) break;
    writeStripPositions({ ...strip, ledCount: count }, positions, cursor);
    rangeOf.fill(ranges.length, cursor, cursor + count);
    ranges.push({ stripId: strip.id, deviceId: strip.deviceId, chipset: strip.chipset, start: cursor, count, visible: strip.visible });
    cursor += count;
  }
  return { positions, rangeOf, ranges, total: cursor };
}

/** Physical length of a strip path in meters (helix approximated by its unrolled length). */
export function stripLength(strip: LEDStrip): number {
  const axial = Math.hypot(strip.end[0] - strip.start[0], strip.end[1] - strip.start[1], strip.end[2] - strip.start[2]);
  if (strip.shape === 'line') return axial;
  const circ = strip.helixTurns * Math.PI * 2 * strip.helixRadius;
  return Math.hypot(axial, circ);
}

export const vecEq = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
