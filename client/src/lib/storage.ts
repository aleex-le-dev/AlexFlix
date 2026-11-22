import type { HeroMode, ViewMode } from '../types';

export interface ProgressEntry {
  itemId: string;
  fileId: string;
  position: number;
  duration: number;
  updatedAt: number;
}

export interface Prefs {
  heroMode: HeroMode;
  view: ViewMode;
  volume: number;
  muted: boolean;
}

const KEYS = {
  favorites: 'alexprime:favorites',
  progress: 'alexprime:progress',
  prefs: 'alexprime:prefs'
} as const;

export const STORAGE_EVENT = 'alexprime:storage';
const MAX_PROGRESS = 300;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown, notify = true): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
  if (notify) notifyStorage();
}

export function notifyStorage(): void {
  window.dispatchEvent(new Event(STORAGE_EVENT));
}

let favoritesCache: { raw: string | null; value: string[] } = { raw: null, value: [] };
export function getFavorites(): string[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEYS.favorites);
  } catch {
    raw = null;
  }
  if (raw !== favoritesCache.raw) favoritesCache = { raw, value: read<string[]>(KEYS.favorites, []) };
  return favoritesCache.value;
}

export function toggleFavorite(id: string): void {
  const list = getFavorites();
  write(KEYS.favorites, list.includes(id) ? list.filter((value) => value !== id) : [id, ...list]);
}

let progressCache: { raw: string | null; value: Record<string, ProgressEntry> } = { raw: null, value: {} };
export function getProgressMap(): Record<string, ProgressEntry> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEYS.progress);
  } catch {
    raw = null;
  }
  if (raw !== progressCache.raw) progressCache = { raw, value: read<Record<string, ProgressEntry>>(KEYS.progress, {}) };
  return progressCache.value;
}

export function saveProgress(entry: ProgressEntry, notify = true): void {
  const map = { ...getProgressMap(), [entry.fileId]: entry };
  const entries = Object.values(map);
  if (entries.length > MAX_PROGRESS) {
    entries.sort((a, b) => b.updatedAt - a.updatedAt);
    const kept: Record<string, ProgressEntry> = {};
    for (const item of entries.slice(0, MAX_PROGRESS)) kept[item.fileId] = item;
    write(KEYS.progress, kept, notify);
    return;
  }
  write(KEYS.progress, map, notify);
}

export function getPrefs(): Prefs {
  return { heroMode: 'banner', view: 'rows', volume: 1, muted: false, ...read<Partial<Prefs>>(KEYS.prefs, {}) };
}

export function setPrefs(patch: Partial<Prefs>, notify = false): void {
  write(KEYS.prefs, { ...getPrefs(), ...patch }, notify);
}
