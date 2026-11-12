import { describe, expect, it } from 'vitest';
import type { LEDStrip } from '../types/voxel';
import { activeCount, buildLayout, normalizeStrip, stripLength } from './geometry';

const strip = (p: Partial<LEDStrip> = {}) =>
  normalizeStrip({ id: 's', name: 'S', deviceId: 'd', gpio: 16, chipset: 'WS2812B', ledCount: 10, shape: 'line', start: [0, 0, 0], end: [9, 0, 0], ...p });

const pos = (layout: ReturnType<typeof buildLayout>, i: number) => [...layout.positions.subarray(i * 3, i * 3 + 3)];

describe('geometry', () => {
  it('lays strips out back to back', () => {
    const l = buildLayout([strip(), strip({ id: 't', ledCount: 5 })]);
    expect(l.total).toBe(15);
    expect(l.ranges.map((r) => [r.start, r.count])).toEqual([
      [0, 10],
      [10, 5],
    ]);
    expect(pos(l, 9)).toEqual([9, 0, 0]);
  });

  it('skipped LEDs are dark and reversal flips the path', () => {
    const s = strip({ skipStart: 2, skipEnd: 1, reversed: true });
    const l = buildLayout([s]);
    expect(activeCount(s)).toBe(7);
    expect([...l.dark.subarray(0, 10)]).toEqual([1, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(pos(l, 2)).toEqual([9, 0, 0]); // first active LED sits at the far end
    expect(pos(l, 8)).toEqual([0, 0, 0]);
  });

  it('serpentine matrix flips odd rows', () => {
    const l = buildLayout([strip({ shape: 'matrix', matrixCols: 3, matrixRows: 2, ledCount: 6, start: [0, 0, 0], end: [2, 0, 1] })]);
    expect(pos(l, 2)).toEqual([2, 0, 0]);
    expect(pos(l, 3)).toEqual([2, 0, 1]); // row 2 starts under the end of row 1
  });

  it('measures shapes', () => {
    expect(stripLength(strip())).toBeCloseTo(9);
    expect(stripLength(strip({ shape: 'arc', helixRadius: 1, arcSweepDeg: 180 }))).toBeCloseTo(Math.PI);
    expect(
      stripLength(
        strip({
          shape: 'polyline',
          points: [
            [0, 0, 0],
            [3, 0, 0],
            [3, 4, 0],
          ],
        }),
      ),
    ).toBeCloseTo(7);
  });
});
