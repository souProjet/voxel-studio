import { describe, expect, it } from 'vitest';
import { defaultProject } from '../state/useVoxelStore';
import { parseProject, serializeProject } from './project';

describe('project files', () => {
  it('round-trips the default project', () => {
    const data = defaultProject();
    expect(parseProject(serializeProject(data))).toEqual(data);
  });

  it('fills fields added after version 1 shipped', () => {
    const file = JSON.parse(serializeProject(defaultProject()));
    delete file.generators;
    delete file.params.palette;
    for (const r of file.routes) delete r.smoothMs;
    for (const s of file.strips) delete s.colorOrder;
    const p = parseProject(JSON.stringify(file));
    expect(p.generators).toEqual([]);
    expect(p.params.palette).toBe('spectrum');
    expect(p.routes.every((r) => r.smoothMs === 0)).toBe(true);
    expect(p.strips.every((s) => s.colorOrder === 'RGB')).toBe(true);
  });

  it('rejects foreign or newer files', () => {
    expect(() => parseProject('{"format":"other"}')).toThrow();
    const file = JSON.parse(serializeProject(defaultProject()));
    file.version = 99;
    expect(() => parseProject(JSON.stringify(file))).toThrow();
    expect(() => parseProject('not json')).toThrow();
  });
});
