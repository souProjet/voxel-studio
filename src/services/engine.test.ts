import { describe, expect, it } from 'vitest';
import { rateGate } from './engine';

function opens(hz: number, tickMs: number, durationMs: number): number[] {
  const gate = rateGate(hz);
  const at: number[] = [];
  for (let t = 0; t <= durationMs; t += tickMs) if (gate(t)) at.push(t);
  return at;
}

describe('rateGate', () => {
  it('holds the average rate with ticks coarser than the period', () => {
    // A 60 Hz requestAnimationFrame, or timers aligned to 16 ms.
    const n = opens(40, 16, 10_000).length;
    expect(n).toBeGreaterThanOrEqual(399);
    expect(n).toBeLessThanOrEqual(401);
  });

  it('holds the average rate with fine ticks and never opens twice within a period', () => {
    const at = opens(40, 5, 10_000);
    expect(at.length).toBeGreaterThanOrEqual(399);
    expect(at.length).toBeLessThanOrEqual(401);
    expect(Math.min(...at.slice(1).map((t, i) => t - at[i]))).toBeGreaterThanOrEqual(24);
  });

  it('resynchronizes after a stall instead of bursting', () => {
    const gate = rateGate(40);
    expect(gate(0)).toBe(true);
    expect(gate(1000)).toBe(true);
    expect(gate(1005)).toBe(false);
    expect(gate(1025)).toBe(true);
  });
});
