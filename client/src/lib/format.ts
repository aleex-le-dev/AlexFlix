import type { MediaFileDTO, MediaItem } from '../types';

const pad = (value: number): string => value.toString().padStart(2, '0');

export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function formatRuntime(minutes: number | null): string {
  if (!minutes) return '';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours} h ${pad(rest)}` : `${rest} min`;
}

export function formatClock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} Go`;
  return `${Math.round(bytes / 1024 ** 2)} Mo`;
}

export function episodeLabel(file: MediaFileDTO): string {
  if (file.season !== null && file.episode !== null) return `S${pad(file.season)}E${pad(file.episode)}`;
  if (file.episode !== null) return `Épisode ${file.episode}`;
  return file.name;
}

export function seasonCount(item: MediaItem): number {
  return new Set(item.files.map((file) => file.season ?? 0)).size;
}

export function itemMeta(item: MediaItem): string {
  if (item.type === 'tv') {
    const seasons = seasonCount(item);
    return seasons > 1 ? `${seasons} saisons` : `${item.files.length} épisode${item.files.length > 1 ? 's' : ''}`;
  }
  return formatRuntime(item.runtime);
}

export const formatRating = (rating: number): string => (rating > 0 ? rating.toFixed(1) : '');

export const matchPercent = (rating: number): number => Math.round(rating * 10);

export const capitalize = (value: string): string => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);

let baselineTime = Number.POSITIVE_INFINITY;

/** Fin de l'import initial (fournie par le catalogue) : rien n'est « récent » avant cette date. */
export function setBaseline(iso: string | null | undefined): void {
  const time = iso ? Date.parse(iso) : Number.NaN;
  baselineTime = Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

export function isRecent(iso: string, days = 30): boolean {
  const time = Date.parse(iso);
  return Number.isFinite(time) && time > baselineTime && Date.now() - time < days * 86400000;
}
