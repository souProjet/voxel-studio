import { describe, expect, it } from 'vitest';
import type { ESP32Device } from '../types/voxel';
import { normalizeStrip } from './geometry';
import { exportMappingCsv, exportMappingJson, parsePointsCsv } from './mappingIO';

const device: ESP32Device = {
  id: 'd',
  name: 'Ctrl',
  chip: 'ESP32',
  ip: '192.168.1.10',
  mac: '',
  port: 4048,
  protocol: 'DDP',
  firmware: 'WLED',
  psuVoltage: 5,
  psuMaxAmps: 4,
  currentLimiter: true,
  online: true,
};
const strips = [
  normalizeStrip({ id: 'a', name: 'A', deviceId: 'd', gpio: 16, chipset: 'WS2812B', ledCount: 3, shape: 'line', start: [0, 0, 0], end: [2, 0, 0], skipStart: 1 }),
  normalizeStrip({ id: 'b', name: 'B', deviceId: 'd', gpio: 17, chipset: 'WS2812B', ledCount: 2, shape: 'line', start: [0, 1, 0], end: [1, 1, 0] }),
];

describe('mapping export', () => {
  it('numbers pixels per device in DDP order', () => {
    const rows = exportMappingCsv(strips, [device]).trim().split('\n');
    expect(rows).toHaveLength(6);
    expect(rows[1].split(',').slice(5, 9)).toEqual(['0', '0', '0', '0']); // skipped LED: inactive
    expect(rows[4].split(',').slice(3, 8)).toEqual(['B', '17', '0', '3', '9']);
  });

  it('writes null for skipped LEDs in JSON', () => {
    const json = JSON.parse(exportMappingJson(strips, [device]));
    expect(json.devices[0].pixels[0]).toBeNull();
    expect(json.devices[0].pixels).toHaveLength(5);
  });
});

describe('points import', () => {
  it('reads x, y, z columns, converts millimeters and counts bad lines', () => {
    const p = parsePointsCsv('id;x;y;z\n0;100;200;300\nbad\n1;1100;200;300\n');
    expect(p.points).toEqual([
      [0.1, 0.2, 0.3],
      [1.1, 0.2, 0.3],
    ]);
    expect(p.convertedFromMm).toBe(true);
    expect(p.skippedLines).toBe(1);
  });

  it('takes the first three numbers without a header', () => {
    expect(parsePointsCsv('0.1\t0.2\t0.3\t9').points).toEqual([[0.1, 0.2, 0.3]]);
  });

  it('rejects files without coordinates', () => {
    expect(() => parsePointsCsv('a,b\nc,d')).toThrow();
  });
});
