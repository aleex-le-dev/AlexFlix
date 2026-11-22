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

export interface SyncHandlers {
  favorites: (profileId: string, favorites: string[]) => void;
  progress: (profileId: string, entry: ProgressEntry) => void;
}

export const STORAGE_EVENT = 'alexflix:storage';
const PREFS_KEY = 'alexflix:prefs';
const LEGACY_PREFS_KEY = 'alexprime:prefs';
const LEGACY_FAVORITES = 'alexprime:favorites';
const LEGACY_PROGRESS = 'alexprime:progress';
const MAX_PROGRESS = 300;

let activeProfile = 'alex';
let sync: SyncHandlers | null = null;

const favoritesKey = (profileId = activeProfile): string => `alexflix:favorites:${profileId}`;
const progressKey = (profileId = activeProfile): string => `alexflix:progress:${profileId}`;

function rawGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function read<T>(key: string, fallback: T): T {
  const raw = rawGet(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
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

export function setSyncHandlers(handlers: SyncHandlers): void {
  sync = handlers;
}

/** Les anciennes données sont migrées vers le préfixe alexflix:. */
function migrateLegacy(): void {
  const oldPrefs = rawGet(LEGACY_PREFS_KEY);
  if (oldPrefs && rawGet(PREFS_KEY) === null) {
    try {
      localStorage.setItem(PREFS_KEY, oldPrefs);
    } catch {
      // ignore
    }
  }
  for (const [legacy, target] of [
    [LEGACY_FAVORITES, favoritesKey('alex')],
    [LEGACY_PROGRESS, progressKey('alex')]
  ] as const) {
    const raw = rawGet(legacy);
    if (raw === null) continue;
    try {
      if (rawGet(target) === null) localStorage.setItem(target, raw);
      localStorage.removeItem(legacy);
    } catch {
      continue;
    }
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('alexprime:')) continue;
      const target = 'alexflix:' + key.slice('alexprime:'.length);
      if (rawGet(target) === null) {
        const val = rawGet(key);
        if (val !== null) localStorage.setItem(target, val);
      }
    }
  } catch {
    // ignore
  }
}
migrateLegacy();

export function setActiveProfile(profileId: string): void {
  activeProfile = profileId;
  notifyStorage();
}

export const getActiveProfile = (): string => activeProfile;

let favoritesCache: { key: string; raw: string | null; value: string[] } = { key: '', raw: null, value: [] };
export function getFavorites(): string[] {
  const key = favoritesKey();
  const raw = rawGet(key);
  if (key !== favoritesCache.key || raw !== favoritesCache.raw) favoritesCache = { key, raw, value: read<string[]>(key, []) };
  return favoritesCache.value;
}

export function toggleFavorite(id: string): void {
  const list = getFavorites();
  const next = list.includes(id) ? list.filter((value) => value !== id) : [id, ...list];
  write(favoritesKey(), next);
  sync?.favorites(activeProfile, next);
}

let progressCache: { key: string; raw: string | null; value: Record<string, ProgressEntry> } = { key: '', raw: null, value: {} };
export function getProgressMap(): Record<string, ProgressEntry> {
  const key = progressKey();
  const raw = rawGet(key);
  if (key !== progressCache.key || raw !== progressCache.raw) progressCache = { key, raw, value: read<Record<string, ProgressEntry>>(key, {}) };
  return progressCache.value;
}

function trimProgress(map: Record<string, ProgressEntry>): Record<string, ProgressEntry> {
  const entries = Object.values(map);
  if (entries.length <= MAX_PROGRESS) return map;
  entries.sort((a, b) => b.updatedAt - a.updatedAt);
  const kept: Record<string, ProgressEntry> = {};
  for (const item of entries.slice(0, MAX_PROGRESS)) kept[item.fileId] = item;
  return kept;
}

export function saveProgress(entry: ProgressEntry, notify = true): void {
  write(progressKey(), trimProgress({ ...getProgressMap(), [entry.fileId]: entry }), notify);
  sync?.progress(activeProfile, entry);
}

/** Remplace les données locales d'un profil par celles du serveur (progression fusionnée, la plus récente gagne). */
export function hydrateProfile(profileId: string, favorites: string[] | undefined, progress: Record<string, ProgressEntry> | undefined): void {
  if (favorites) write(favoritesKey(profileId), favorites, false);
  if (progress) {
    const local = read<Record<string, ProgressEntry>>(progressKey(profileId), {});
    const merged: Record<string, ProgressEntry> = { ...local };
    for (const entry of Object.values(progress)) {
      const current = merged[entry.fileId];
      if (!current || current.updatedAt <= entry.updatedAt) merged[entry.fileId] = entry;
    }
    write(progressKey(profileId), trimProgress(merged), false);
  }
  notifyStorage();
}

export function readProfileData(profileId: string): { favorites: string[]; progress: Record<string, ProgressEntry> } {
  return {
    favorites: read<string[]>(favoritesKey(profileId), []),
    progress: read<Record<string, ProgressEntry>>(progressKey(profileId), {})
  };
}

export function clearProfileData(profileId: string): void {
  try {
    localStorage.removeItem(favoritesKey(profileId));
    localStorage.removeItem(progressKey(profileId));
  } catch {
    return;
  }
}

export function getPrefs(): Prefs {
  return { heroMode: 'banner', view: 'rows', volume: 1, muted: false, ...read<Partial<Prefs>>(PREFS_KEY, {}) };
}

export function setPrefs(patch: Partial<Prefs>, notify = false): void {
  write(PREFS_KEY, { ...getPrefs(), ...patch }, notify);
}
