import { useSyncExternalStore } from 'react';
import { FR } from './fr';

export type Lang = 'en' | 'fr';

const STORAGE_KEY = 'voxel-studio:lang';

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'fr') return saved;
  } catch {
    // Storage blocked: fall back to the system language.
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

let lang: Lang = detect();
const listeners = new Set<() => void>();

export const getLang = () => lang;

export function setLang(next: Lang): void {
  if (next === lang) return;
  lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // The choice still applies for this session.
  }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  listeners.forEach((l) => l());
}

export function useLang(): Lang {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, getLang);
}

/**
 * Translates UI text. The English text is the key; French comes from src/i18n/fr, English is
 * the fallback. `{name}` placeholders are filled from `vars`. Call it with a string literal so
 * the dictionary test can check coverage; for text stored as data, mark the literal with `tk`.
 */
export function t(text: string, vars?: Record<string, string | number>): string {
  const s = lang === 'fr' ? (FR[text] ?? text) : text;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Marks a literal stored as data (catalog labels) for translation at display time with `t`. */
export const tk = <T extends string>(text: T): T => text;
