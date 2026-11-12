import type { ESP32Device, LEDStrip, Vec3 } from '../types/voxel';
import { buildLayout } from './geometry';

const f4 = (v: number) => v.toFixed(4);
const csvCell = (v: string | number) => {
  const t = String(v);
  return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

interface PixelRow {
  device: ESP32Device;
  strip: LEDStrip;
  stripLed: number;
  devicePixel: number;
  active: boolean;
  pos: Vec3;
}

/** Every physical LED in DDP order per device (the order the controller receives bytes). */
function pixelRows(strips: LEDStrip[], devices: ESP32Device[]): PixelRow[] {
  const layout = buildLayout(strips);
  const rows: PixelRow[] = [];
  const nextPixel = new Map<string, number>();
  for (const r of layout.ranges) {
    const device = devices.find((d) => d.id === r.deviceId);
    const strip = strips.find((x) => x.id === r.stripId);
    if (!device || !strip) continue;
    let px = nextPixel.get(device.id) ?? 0;
    for (let j = 0; j < r.count; j++) {
      const i = r.start + j;
      const p = layout.positions;
      rows.push({ device, strip, stripLed: j, devicePixel: px++, active: !layout.dark[i], pos: [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]] });
    }
    nextPixel.set(device.id, px);
  }
  return rows;
}

/** One row per LED: where to find it on the wire and where it is in the room (meters). */
export function exportMappingCsv(strips: LEDStrip[], devices: ESP32Device[]): string {
  const header = ['device', 'ip', 'port', 'segment', 'gpio', 'segment_led', 'device_pixel', 'ddp_byte_offset', 'active', 'x_m', 'y_m', 'z_m'];
  const lines = pixelRows(strips, devices).map((r) =>
    [
      r.device.name,
      r.device.ip,
      r.device.port,
      r.strip.name,
      r.strip.gpio,
      r.stripLed,
      r.devicePixel,
      r.devicePixel * 3,
      r.active ? 1 : 0,
      f4(r.pos[0]),
      f4(r.pos[1]),
      f4(r.pos[2]),
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n') + '\n';
}

/** Per device, pixel positions in DDP order; skipped LEDs are null. */
export function exportMappingJson(strips: LEDStrip[], devices: ESP32Device[]): string {
  const rows = pixelRows(strips, devices);
  const out = devices
    .filter((d) => rows.some((r) => r.device.id === d.id))
    .map((d) => ({
      name: d.name,
      ip: d.ip,
      port: d.port,
      segments: strips.filter((s) => s.deviceId === d.id).map((s) => ({ name: s.name, gpio: s.gpio, leds: s.ledCount })),
      pixels: rows.filter((r) => r.device.id === d.id).map((r) => (r.active ? r.pos.map((v) => +f4(v)) : null)),
    }));
  return JSON.stringify({ format: 'voxel-studio-mapping', version: 1, units: 'm', devices: out }, null, 2) + '\n';
}

export interface ParsedPoints {
  points: Vec3[];
  /** True when values looked like millimeters and were converted to meters. */
  convertedFromMm: boolean;
  skippedLines: number;
}

/**
 * Reads x, y, z per line from CSV / TSV / semicolon text. Uses columns named x, y, z when a
 * header has them, else the first three numeric columns. Values above 50 are taken as
 * millimeters (no room is 50 m wide) and converted.
 */
export function parsePointsCsv(text: string): ParsedPoints {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) throw new Error('The file is empty.');
  const delim = [',', ';', '\t'].map((d) => ({ d, n: lines[0].split(d).length })).sort((a, b) => b.n - a.n)[0].d;
  const split = (l: string) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''));
  const first = split(lines[0]);
  const hasHeader = first.some((c) => c !== '' && Number.isNaN(Number(c)));
  let cols: number[] | null = null;
  if (hasHeader) {
    const lower = first.map((c) => c.toLowerCase());
    const find = (axis: string) => lower.findIndex((c) => c === axis || c.startsWith(`${axis}_`) || c.startsWith(`${axis} `));
    const xyz = ['x', 'y', 'z'].map(find);
    if (xyz.every((i) => i >= 0)) cols = xyz;
  }
  const points: Vec3[] = [];
  let skippedLines = 0;
  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const cells = split(line);
    const nums = cols ? cols.map((i) => Number(cells[i])) : cells.filter((c) => c !== '').map(Number).filter((n) => !Number.isNaN(n)).slice(0, 3);
    if (nums.length < 3 || nums.some((n) => !Number.isFinite(n))) {
      skippedLines++;
      continue;
    }
    points.push([nums[0], nums[1], nums[2]]);
  }
  if (points.length === 0) throw new Error('No x, y, z values found. Expected three numeric columns or a header with x, y, z.');
  const max = points.reduce((m, p) => Math.max(m, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2])), 0);
  const convertedFromMm = max > 50;
  return {
    points: convertedFromMm ? points.map((p) => p.map((v) => v / 1000) as Vec3) : points,
    convertedFromMm,
    skippedLines,
  };
}
