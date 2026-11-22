import { config } from '../config.js';
import type { MediaType } from '../types.js';
import { createLimiter } from './limiter.js';
import { normalizeKey, sleep } from './utils.js';

const API_BASE = 'https://api.themoviedb.org/3';
export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

const limit = createLimiter(6);

export const tmdbEnabled = (): boolean => config.tmdbApiKey.length > 0;

type Params = Record<string, string | number | boolean | null | undefined>;

export async function tmdbRequest<T>(endpoint: string, params: Params = {}): Promise<T> {
  const url = new URL(`${API_BASE}${endpoint}`);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (config.tmdbApiKey.startsWith('eyJ')) headers.authorization = `Bearer ${config.tmdbApiKey}`;
  else url.searchParams.set('api_key', config.tmdbApiKey);
  url.searchParams.set('language', config.tmdbLanguage);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  return limit(async () => {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      } catch (error) {
        if (attempt < 2) {
          await sleep(800 * (attempt + 1));
          continue;
        }
        throw error;
      }
      if (response.status === 429 && attempt < 5) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * (attempt + 1));
        continue;
      }
      if (response.status >= 500 && attempt < 2) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (!response.ok) throw new Error(`TMDB ${response.status} sur ${endpoint}`);
      return (await response.json()) as T;
    }
  });
}

interface SearchResult {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  popularity?: number;
}

function pickBest(results: SearchResult[], title: string, year: number | null): SearchResult | null {
  if (results.length === 0) return null;
  const target = normalizeKey(title);
  let best: SearchResult | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  results.slice(0, 8).forEach((result, index) => {
    const names = [result.title, result.name, result.original_title, result.original_name]
      .filter((name): name is string => Boolean(name))
      .map(normalizeKey);
    let score = -index * 0.5;
    if (names.includes(target)) score += 10;
    const resultYear = Number((result.release_date ?? result.first_air_date ?? '').slice(0, 4));
    if (year && resultYear === year) score += 5;
    else if (year && Math.abs(resultYear - year) === 1) score += 2;
    score += Math.min((result.popularity ?? 0) / 50, 3);
    if (score > bestScore) {
      bestScore = score;
      best = result;
    }
  });
  return best;
}

interface Attempt {
  query: string;
  year: number | null;
  /** Recherche approximative : le résultat doit contenir la requête dans son titre (ou correspondre à l'année). */
  strict: boolean;
}

function resultMatches(result: SearchResult, query: string, year: number | null): boolean {
  const target = normalizeKey(query);
  const names = [result.title, result.name, result.original_title, result.original_name]
    .filter((name): name is string => Boolean(name))
    .map(normalizeKey);
  void year;
  return names.some((name) => name.includes(target) || (name.split(' ').length >= 2 && target.includes(name)));
}

/** Requêtes successives : titre exact, puis sans numéros de saga / années tronquées, puis préfixes du titre. */
function buildAttempts(title: string, year: number | null): Attempt[] {
  const attempts: Attempt[] = [];
  const seen = new Set<string>();
  const add = (query: string, attemptYear: number | null, strict: boolean): void => {
    const clean = query.replace(/\s+/g, ' ').trim();
    const key = `${normalizeKey(clean)}|${attemptYear ?? ''}`;
    if (clean.length < 2 || seen.has(key)) return;
    seen.add(key);
    attempts.push({ query: clean, year: attemptYear, strict });
  };

  if (year) add(title, year, false);
  if (year) add(`${title} ${year}`, null, false);
  add(title, null, false);

  const withoutNumbers = title.replace(/\b\d{1,4}\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (withoutNumbers && withoutNumbers !== title) {
    if (year) add(withoutNumbers, year, false);
    add(withoutNumbers, null, true);
  }

  const words = (withoutNumbers || title).split(' ').filter(Boolean);
  for (let length = words.length - 1; length >= 2; length--) {
    const prefix = words.slice(0, length).join(' ');
    if (year) add(prefix, year, true);
    else if (length >= 3) add(prefix, null, true);
  }
  if (year && words[0] && words[0].length >= 6) add(words[0], year, true);
  return attempts.slice(0, 12);
}

export async function searchTmdb(type: MediaType, title: string, year: number | null): Promise<number | null> {
  const endpoint = type === 'movie' ? '/search/movie' : '/search/tv';
  const yearKey = type === 'movie' ? 'year' : 'first_air_date_year';

  for (const attempt of buildAttempts(title, year)) {
    const data = await tmdbRequest<{ results?: SearchResult[] }>(endpoint, {
      query: attempt.query,
      [yearKey]: attempt.year ?? undefined,
      include_adult: false
    });
    const candidates = (data.results ?? []).filter((result) => {
      const resultYear = Number((result.release_date ?? result.first_air_date ?? '').slice(0, 4));
      if (year && type === 'movie' && resultYear && Math.abs(resultYear - year) > 1) return false;
      if (attempt.strict && attempt.year && resultYear !== attempt.year) return false;
      return !attempt.strict || resultMatches(result, attempt.query, attempt.year);
    });
    const best = pickBest(candidates, attempt.query, year);
    if (best) return best.id;
  }
  return null;
}

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbVideo {
  key: string;
  site: string;
  type: string;
  iso_639_1: string;
  official?: boolean;
}

export interface TmdbMovie {
  id: number;
  title: string;
  original_title: string;
  release_date?: string;
  overview: string;
  tagline?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  vote_count: number;
  runtime: number | null;
  genres: TmdbGenre[];
  keywords?: { keywords?: Array<{ name: string }> };
  credits?: { cast?: Array<{ name: string }>; crew?: Array<{ name: string; job: string }> };
  videos?: { results?: TmdbVideo[] };
}

export interface TmdbTv {
  id: number;
  name: string;
  original_name: string;
  first_air_date?: string;
  overview: string;
  tagline?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  vote_count: number;
  episode_run_time?: number[];
  last_episode_to_air?: { runtime?: number | null } | null;
  genres: TmdbGenre[];
  keywords?: { results?: Array<{ name: string }> };
  aggregate_credits?: { cast?: Array<{ name: string }> };
  created_by?: Array<{ name: string }>;
  videos?: { results?: TmdbVideo[] };
}

export interface TmdbSeason {
  name: string;
  overview?: string;
  poster_path: string | null;
  season_number: number;
  episodes?: Array<{
    episode_number: number;
    name: string;
    overview?: string;
    still_path: string | null;
    air_date?: string | null;
    runtime?: number | null;
  }>;
}

export const getMovie = (id: number): Promise<TmdbMovie> =>
  tmdbRequest<TmdbMovie>(`/movie/${id}`, { append_to_response: 'credits,keywords,videos', include_video_language: 'fr,en,null' });

export const getTv = (id: number): Promise<TmdbTv> =>
  tmdbRequest<TmdbTv>(`/tv/${id}`, { append_to_response: 'aggregate_credits,keywords,videos', include_video_language: 'fr,en,null' });

export const getSeason = (tvId: number, season: number): Promise<TmdbSeason> =>
  tmdbRequest<TmdbSeason>(`/tv/${tvId}/season/${season}`);

export async function getFallbackOverview(type: MediaType, id: number): Promise<string> {
  const data = await tmdbRequest<{ overview?: string }>(`/${type}/${id}`, { language: 'en-US' });
  return data.overview ?? '';
}
