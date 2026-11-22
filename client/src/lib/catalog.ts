import type { Facet, MediaItem, RowDef, Tab } from '../types';
import { isRecent, normalizeText } from './format';
import type { ProgressEntry } from './storage';

export interface Filters {
  tab: Tab;
  genre: string | null;
  theme: string | null;
  query: string;
  favorites: string[];
}

const haystacks = new WeakMap<MediaItem, string>();

function haystack(item: MediaItem): string {
  let value = haystacks.get(item);
  if (!value) {
    value = normalizeText(
      [
        item.title,
        item.originalTitle,
        item.year ?? '',
        ...item.cast,
        ...item.directors,
        ...item.categories,
        ...item.genres,
        ...item.keywords
      ].join(' | ')
    );
    haystacks.set(item, value);
  }
  return value;
}

export function matchesQuery(item: MediaItem, query: string): boolean {
  const terms = normalizeText(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const text = haystack(item);
  return terms.every((term) => text.includes(term));
}

function searchScore(item: MediaItem, query: string): number {
  const target = normalizeText(query).trim();
  const terms = target.split(/\s+/).filter(Boolean);
  const titles = [item.title, item.originalTitle].map(normalizeText);
  if (titles.some((title) => title === target)) return 5;
  if (titles.some((title) => title.startsWith(target))) return 4;
  if (titles.some((title) => title.includes(target))) return 3;
  if (titles.some((title) => terms.every((term) => title.includes(term)))) return 2;
  if (titles.some((title) => terms.some((term) => title.includes(term)))) return 1;
  return 0;
}

/** Résultats de recherche : pertinence du titre, puis ordre chronologique (sagas dans l'ordre), puis alphabétique. */
export function sortSearchResults(items: MediaItem[], query: string): MediaItem[] {
  return items
    .map((item) => ({ item, score: searchScore(item, query) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.item.year ?? 9999) - (b.item.year ?? 9999) ||
        a.item.title.localeCompare(b.item.title, 'fr', { numeric: true, sensitivity: 'base' })
    )
    .map((entry) => entry.item);
}

export function filterItems(items: MediaItem[], filters: Filters): MediaItem[] {
  return items.filter((item) => {
    if (filters.tab === 'movies' && item.type !== 'movie') return false;
    if (filters.tab === 'tv' && item.type !== 'tv') return false;
    if (filters.tab === 'mylist' && !filters.favorites.includes(item.id)) return false;
    if (filters.genre && !item.categories.includes(filters.genre)) return false;
    if (filters.theme && !item.keywords.includes(filters.theme)) return false;
    return matchesQuery(item, filters.query);
  });
}

function toFacets(counts: Map<string, number>): Facet[] {
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fr'));
}

const ROOT_CATEGORY = 'Nouveautés';
const SERIES_CATEGORY = 'Séries';

/** Ordre des catégories : Nouveautés, puis dossiers par ordre alphabétique, Séries en dernier. */
function categoryRank(name: string): number {
  if (name === ROOT_CATEGORY) return 0;
  if (name === SERIES_CATEGORY) return 2;
  return 1;
}

/** `genres` = catégories (dossiers du disque) ; `themes` = mots-clés TMDB. */
export function facetsOf(items: MediaItem[]): { genres: Facet[]; themes: Facet[] } {
  const categories = new Map<string, number>();
  const themes = new Map<string, number>();
  for (const item of items) {
    for (const category of item.categories) categories.set(category, (categories.get(category) ?? 0) + 1);
    for (const keyword of item.keywords) themes.set(keyword, (themes.get(keyword) ?? 0) + 1);
  }
  return {
    genres: [...categories.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => categoryRank(a.name) - categoryRank(b.name) || a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })),
    themes: toFacets(themes)
      .filter((facet) => facet.count >= 2 || items.length < 30)
      .slice(0, 80)
  };
}

const byAddedDesc = (a: MediaItem, b: MediaItem): number => b.addedAt.localeCompare(a.addedAt);

const sessionSeed = Math.floor(Math.random() * 0xffffffff);

function seededRank(id: string): number {
  let hash = sessionSeed;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 2654435761) >>> 0;
  return hash;
}

/** Mise en avant : nouveautés réelles d'abord, puis sélection aléatoire stable pendant la visite. */
export function pickFeatured(items: MediaItem[]): MediaItem[] {
  const withArt = items.filter((item) => item.backdrop);
  const pool = withArt.length > 0 ? withArt : items;
  const recent = pool.filter((item) => isRecent(item.addedAt)).sort(byAddedDesc);
  const others = pool.filter((item) => !isRecent(item.addedAt)).sort((a, b) => seededRank(a.id) - seededRank(b.id));
  return [...recent, ...others].slice(0, 10);
}

export function itemProgress(item: MediaItem, progress: Record<string, ProgressEntry>): ProgressEntry | null {
  let latest: ProgressEntry | null = null;
  for (const file of item.files) {
    const entry = progress[file.id];
    if (entry && (!latest || entry.updatedAt > latest.updatedAt)) latest = entry;
  }
  return latest;
}

export function progressRatio(entry: ProgressEntry | null): number {
  if (!entry || entry.duration <= 0) return 0;
  return Math.min(1, Math.max(0, entry.position / entry.duration));
}

export function resumeFileId(item: MediaItem, progress: Record<string, ProgressEntry>): string | undefined {
  if (item.files.length === 0) return undefined;
  const last = itemProgress(item, progress);
  if (!last) return item.files[0].id;
  if (progressRatio(last) < 0.95) return last.fileId;
  const index = item.files.findIndex((file) => file.id === last.fileId);
  return item.files[index + 1]?.id ?? item.files[0].id;
}

interface RowOptions {
  progress: Record<string, ProgressEntry>;
  favorites: string[];
  activeGenre: string | null;
  activeTheme: string | null;
}

export function buildRows(items: MediaItem[], options: RowOptions): RowDef[] {
  const rows: RowDef[] = [];
  const push = (row: RowDef): void => {
    if (row.items.length > 0) rows.push(row);
  };
  const byId = new Map(items.map((item) => [item.id, item]));

  const seen = new Set<string>();
  const continueItems: MediaItem[] = [];
  for (const entry of Object.values(options.progress).sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (seen.has(entry.itemId)) continue;
    seen.add(entry.itemId);
    const ratio = progressRatio(entry);
    if (ratio < 0.01 || ratio > 0.95) continue;
    const item = byId.get(entry.itemId);
    if (item) continueItems.push(item);
  }
  push({ id: 'continue', title: 'Reprendre la lecture', items: continueItems });

  push({
    id: 'mylist',
    title: 'Ma liste',
    items: options.favorites.map((id) => byId.get(id)).filter((item): item is MediaItem => item !== undefined)
  });

  push({
    id: 'recent',
    title: 'Ajoutés récemment',
    items: items
      .filter((item) => isRecent(item.addedAt))
      .sort(byAddedDesc)
      .slice(0, 24)
  });

  const top = items
    .filter((item) => item.rating >= 7 && item.voteCount >= 30)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 24);
  if (top.length >= 3) push({ id: 'top', title: 'Les mieux notés', items: top });

  const { genres } = facetsOf(items);
  for (const category of genres) {
    if (category.name === options.activeGenre) continue;
    push({
      id: `category-${category.name}`,
      title: category.name,
      items: items.filter((item) => item.categories.includes(category.name)).sort(byAddedDesc),
      filter: { genre: category.name }
    });
  }

  return rows;
}
