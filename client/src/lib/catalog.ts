import type { Facet, MediaItem, RowDef, Tab } from '../types';
import { isRecent, isUhd, normalizeText } from './format';
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
        ...(item.collections ?? []),
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

/** Catégorie virtuelle : tous les titres notés, classés du mieux au moins bien noté. */
export const TOP_CATEGORY = 'Les mieux notés';

export const rankByRating = (list: MediaItem[]): MediaItem[] =>
  list.filter((item) => item.rating > 0).sort((a, b) => b.rating - a.rating || b.voteCount - a.voteCount);

/**
 * Profil Enfants (jeunes enfants) : uniquement l'animation et les films familiaux,
 * et en plus classés « Tous publics » / -10 quand l'âge est connu. Jamais d'horreur.
 */
const KIDS_MAX_AGE = 10;
const KIDS_GENRES = /animation|familial|famille/i;
export function kidsAllowed(item: MediaItem): boolean {
  if (item.genres.some((genre) => /horreur/i.test(genre))) return false;
  if (!item.genres.some((genre) => KIDS_GENRES.test(genre))) return false;
  if (typeof item.age === 'number' && item.age > KIDS_MAX_AGE) return false;
  // Animation : la classification suffit. Film familial « live » : il faut aussi G ou PG aux États-Unis
  // (TMDB étiquette « Familial » des comédies comme Alibi.com).
  if (item.genres.some((genre) => /animation/i.test(genre))) return true;
  return typeof item.ageUs === 'number' && item.ageUs <= KIDS_MAX_AGE;
}

export function filterItems(items: MediaItem[], filters: Filters): MediaItem[] {
  return items.filter((item) => {
    if (filters.tab === 'movies' && item.type !== 'movie') return false;
    if (filters.tab === 'tv' && item.type !== 'tv') return false;
    if (filters.tab === 'mylist' && !filters.favorites.includes(item.id)) return false;
    if (filters.genre === TOP_CATEGORY) {
      if (item.rating <= 0) return false;
    } else if (filters.genre && !item.categories.includes(filters.genre)) return false;
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
const SERIES_CATEGORY = 'Autres séries';

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

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50 };
function romanValue(value: string): number {
  let total = 0;
  for (let i = 0; i < value.length; i++) {
    const current = ROMAN[value[i]] ?? 0;
    const next = ROMAN[value[i + 1]] ?? 0;
    total += current < next ? -current : current;
  }
  return total;
}

const sagaNumbers = new WeakMap<MediaItem, number | null>();
/**
 * Numéro dans la saga, lu dans le nom du fichier : « Episode IV », « 3 Harry Potter… »,
 * « Mission Impossible 5 … » (ni année, ni 4k/2160p, ni « Partie 2 »). null si aucun.
 */
export function sagaNumber(item: MediaItem): number | null {
  if (sagaNumbers.has(item)) return sagaNumbers.get(item) ?? null;
  let result: number | null = null;
  const name = (item.files[0]?.name ?? '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[._]/g, ' ');
  if (item.type === 'movie') {
    const episode = /(?:^|[\s,])[ée]pisode\s+([IVXL]+|\d{1,2})(?![\p{L}\d])/iu.exec(name);
    const leading = /^\s*(\d{1,2})(?:\s*[-–]\s*|\s+)\D/.exec(name);
    const inner = /(?:^|\s)(?<!partie\s|part\s)(\d{1,2})(?![\d]|\s*[kp]\b|k)(?=\s|\)|$)/i.exec(name);
    if (episode) result = /^\d+$/.test(episode[1]) ? Number(episode[1]) : romanValue(episode[1].toUpperCase());
    else if (leading) result = Number(leading[1]);
    else if (inner) result = Number(inner[1]);
  }
  sagaNumbers.set(item, result);
  return result;
}

/** Ordre de saga : numéro d'épisode d'abord, puis les hors-série par année. */
const bySaga = (a: MediaItem, b: MediaItem): number => {
  const na = sagaNumber(a);
  const nb = sagaNumber(b);
  if (na !== null && nb !== null && na !== nb) return na - nb;
  if (na !== null && nb === null) return -1;
  if (na === null && nb !== null) return 1;
  return (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title, 'fr');
};

/**
 * Regroupe les sagas dans une rangée : au premier film d'une saga rencontré, tous ses films présents
 * dans la rangée suivent, dans l'ordre de la saga. Les autres titres gardent leur place.
 */
export function groupSagas(list: MediaItem[]): MediaItem[] {
  const groups = new Map<string, MediaItem[]>();
  for (const item of list) {
    const key = item.collections?.[0];
    if (key) groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const out: MediaItem[] = [];
  const done = new Set<string>();
  for (const item of list) {
    const key = item.collections?.[0];
    if (!key) out.push(item);
    else if (!done.has(key)) {
      done.add(key);
      out.push(...(groups.get(key) ?? []).sort(bySaga));
    }
  }
  return out;
}

const byYear = bySaga;
const byRating = (a: MediaItem, b: MediaItem): number => b.rating - a.rating;

/**
 * Rangées d'une catégorie ouverte : chaque sous-dossier (saga) du disque, puis des filtres automatiques.
 * Une rangée n'apparaît que si elle a au moins 2-3 titres et n'est pas identique à toute la catégorie.
 */
function categoryRows(items: MediaItem[], progress: Record<string, ProgressEntry>, category: string): RowDef[] {
  const rows: RowDef[] = [];
  const total = items.length;
  const add = (id: string, title: string, list: MediaItem[], min = 3): void => {
    if (list.length >= min && list.length < total) rows.push({ id, title, items: groupSagas(list) });
  };

  const collections = new Map<string, MediaItem[]>();
  for (const item of items) {
    for (const name of item.collections ?? []) collections.set(name, [...(collections.get(name) ?? []), item]);
  }
  for (const [name, list] of [...collections].sort((a, b) => a[0].localeCompare(b[0], 'fr', { sensitivity: 'base' }))) {
    // Séries : une rangée dès 1 titre ; films : à partir de 2.
    add(`collection-${name}`, name, [...list].sort(byYear), list.every((item) => item.type === 'tv') ? 1 : 2);
  }

  const outside = items.filter((item) => !(item.collections ?? []).length);
  add('loose', `Autres films · ${category}`, [...outside].sort(byAddedDesc), 2);

  add('uhd', 'En 4K', items.filter(isUhd).sort(byRating));

  const started = new Set(Object.values(progress).map((entry) => entry.itemId));
  add('unseen', 'Pas encore vus', items.filter((item) => !started.has(item.id)).sort(byRating));

  add('short', 'Moins de 1 h 45', items.filter((item) => item.type === 'movie' && item.runtime && item.runtime < 105).sort(byRating));
  add('long', 'Grandes fresques (2 h 30 et plus)', items.filter((item) => item.runtime && item.runtime >= 150).sort(byRating));

  for (const [from, to, title] of [
    [2020, 9999, 'Années 2020'],
    [2010, 2019, 'Années 2010'],
    [2000, 2009, 'Années 2000'],
    [0, 1999, 'Classiques (avant 2000)']
  ] as const) {
    add(`decade-${from}`, title, items.filter((item) => item.year !== null && item.year >= from && item.year <= to).sort(byRating));
  }

  const genres = new Map<string, MediaItem[]>();
  for (const item of items) for (const genre of item.genres) genres.set(genre, [...(genres.get(genre) ?? []), item]);
  const norm = (value: string): string => normalizeText(value);
  [...genres]
    .filter(([genre]) => norm(genre) !== norm(category))
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 6)
    .forEach(([genre, list]) => add(`genre-${genre}`, `Genre : ${genre}`, [...list].sort(byRating), 4));

  return rows;
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
    if (row.items.length > 0) rows.push(row.id === 'continue' || row.id === 'top' ? row : { ...row, items: groupSagas(row.items) });
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

  // Toujours les 20 titres les mieux notés, du meilleur au moins bon (pas de regroupement par saga).
  push({ id: 'top', title: TOP_CATEGORY, items: rankByRating(items).slice(0, 20), filter: { genre: TOP_CATEGORY } });

  if (options.activeGenre) rows.push(...categoryRows(items, options.progress, options.activeGenre));

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
