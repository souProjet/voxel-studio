import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FR } from './fr';
import { setLang, t } from './index';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'i18n' ? [] : sourceFiles(p);
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') ? [p] : [];
  });
}

/** Literal arguments of t('...') and tk('...'), in single, double or backtick quotes without ${}. */
function translatableLiterals(code: string): string[] {
  const out: string[] = [];
  const re = /\bt[k]?\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\$]|\\.)*)`)/g;
  for (const m of code.matchAll(re)) out.push((m[1] ?? m[2] ?? m[3]).replace(/\\(['"`\\])/g, '$1'));
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('French dictionary', () => {
  const used = new Map<string, string>();
  for (const file of sourceFiles(SRC)) {
    for (const text of translatableLiterals(readFileSync(file, 'utf8'))) used.set(text, relative(SRC, file));
  }

  it('translates every UI string', () => {
    const missing = [...used].filter(([text]) => !(text in FR)).map(([text, file]) => `${file}: ${text}`);
    expect(missing).toEqual([]);
  });

  it('keeps the same placeholders', () => {
    const broken = Object.entries(FR).filter(([en, fr]) => placeholders(en).join() !== placeholders(fr).join());
    expect(broken).toEqual([]);
  });

  it('defines each key in one area file only', async () => {
    const areas = ['common', 'studio', 'stage', 'patch', 'data'];
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const area of areas) {
      const dict = ((await import(`./fr/${area}.ts`)) as { default: Record<string, string> }).default;
      for (const key of Object.keys(dict)) {
        if (seen.has(key)) dupes.push(`${key} (${seen.get(key)} + ${area})`);
        else seen.set(key, area);
      }
    }
    expect(dupes).toEqual([]);
  });

  it('has no unused entries', () => {
    expect(Object.keys(FR).filter((k) => !used.has(k))).toEqual([]);
  });

  it('fills placeholders and falls back to English', () => {
    setLang('fr');
    expect(t('Language')).toBe('Langue');
    expect(t('Not in the dictionary {n}', { n: 3 })).toBe('Not in the dictionary 3');
    setLang('en');
    expect(t('Language')).toBe('Language');
  });
});
