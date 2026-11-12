import { describe, expect, it } from 'vitest';
import { DDP_FLAG_PUSH, DDP_FLAG_VER1, DDP_HEADER_LEN, DDP_MAX_PAYLOAD, encodeDdpPackets } from './tauriBridge';

describe('DDP encoder', () => {
  it('writes a single-packet header with PUSH', () => {
    const [p] = encodeDdpPackets(new Uint8Array(30).fill(0xaa), 3);
    expect([...p.subarray(0, DDP_HEADER_LEN)]).toEqual([0x41, 0x03, 0x0b, 0x01, 0, 0, 0, 0, 0, 30]);
    expect(p.length).toBe(DDP_HEADER_LEN + 30);
  });

  it('splits frames with byte offsets and PUSH on the last packet only', () => {
    const rgb = new Uint8Array(600 * 3).map((_, i) => i % 251);
    const pkts = encodeDdpPackets(rgb, 17);
    expect(pkts).toHaveLength(2);
    expect(pkts[0][0]).toBe(DDP_FLAG_VER1);
    expect(pkts[1][0]).toBe(DDP_FLAG_VER1 | DDP_FLAG_PUSH);
    expect(pkts[0][1]).toBe(1); // 17 & 0x0F
    const offset = (pkts[1][4] << 24) | (pkts[1][5] << 16) | (pkts[1][6] << 8) | pkts[1][7];
    expect(offset).toBe(DDP_MAX_PAYLOAD);
    expect((pkts[1][8] << 8) | pkts[1][9]).toBe(rgb.length - DDP_MAX_PAYLOAD);
    expect(pkts[1][DDP_HEADER_LEN]).toBe(rgb[DDP_MAX_PAYLOAD]);
  });

  it('still pushes an empty frame', () => {
    const pkts = encodeDdpPackets(new Uint8Array(0), 1);
    expect(pkts).toHaveLength(1);
    expect(pkts[0].length).toBe(DDP_HEADER_LEN);
    expect(pkts[0][0]).toBe(DDP_FLAG_VER1 | DDP_FLAG_PUSH);
  });
});
