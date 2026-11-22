import { config } from '../config.js';
import type { EpisodeMeta, MediaItem, MediaType, ParsedName, SeasonMeta } from '../types.js';
import { cacheImage } from './images.js';
import { getFallbackOverview, getMovie, getSeason, getTv, type TmdbVideo } from './tmdb.js';
import { normalizeKey, nowIso, sha1 } from './utils.js';

export type ItemMeta = Omit<MediaItem, 'id' | 'fileIds' | 'addedAt' | 'seasons'>;

const GENRE_ALIASES: Record<string, string> = {
  Adventure: 'Aventure',
  War: 'Guerre',
  Politics: 'Politique',
  Kids: 'Enfants',
  News: 'Actualités',
  Reality: 'Téléréalité',
  Soap: 'Feuilleton',
  Talk: 'Talk-show',
  'Sci-Fi': 'Science-Fiction',
  Fantasy: 'Fantastique'
};

export function normalizeGenres(names: string[]): string[] {
  const french = config.tmdbLanguage.toLowerCase().startsWith('fr');
  const out: string[] = [];
  for (const name of names) {
    for (const part of name.split(/\s*&\s*/)) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const value = french ? (GENRE_ALIASES[trimmed] ?? trimmed) : trimmed;
      if (!out.includes(value)) out.push(value);
    }
  }
  return out;
}

function pickTrailer(videos: TmdbVideo[] | undefined): string | null {
  const youtube = (videos ?? []).filter((video) => video.site === 'YouTube');
  const ranked = [
    youtube.find((v) => v.type === 'Trailer' && v.iso_639_1 === 'fr' && v.official),
    youtube.find((v) => v.type === 'Trailer' && v.iso_639_1 === 'fr'),
    youtube.find((v) => v.type === 'Trailer' && v.official),
    youtube.find((v) => v.type === 'Trailer'),
    youtube.find((v) => v.type === 'Teaser')
  ];
  return ranked.find((video) => video !== undefined)?.key ?? null;
}

const yearOf = (date: string | undefined): number | null => {
  const year = Number((date ?? '').slice(0, 4));
  return Number.isFinite(year) && year > 1800 ? year : null;
};

const round1 = (value: number | undefined): number => Math.round((value ?? 0) * 10) / 10;

export const tmdbItemId = (type: MediaType, tmdbId: number): string => `${type}-${tmdbId}`;

export function localItemId(parsed: ParsedName): string {
  return `local-${parsed.type}-${sha1(`${normalizeKey(parsed.title)}|${parsed.year ?? ''}`).slice(0, 10)}`;
}

export function localMeta(parsed: ParsedName): ItemMeta {
  return {
    type: parsed.type,
    tmdbId: null,
    title: parsed.title,
    originalTitle: parsed.title,
    year: parsed.year,
    overview: '',
    tagline: '',
    poster: null,
    backdrop: null,
    rating: 0,
    voteCount: 0,
    runtime: null,
    genres: [],
    keywords: [],
    cast: [],
    directors: [],
    trailer: null,
    updatedAt: nowIso()
  };
}

export async function fetchMeta(itemId: string, type: MediaType, tmdbId: number): Promise<ItemMeta> {
  if (type === 'movie') {
    const movie = await getMovie(tmdbId);
    const overview = movie.overview || (await getFallbackOverview('movie', tmdbId).catch(() => ''));
    const [poster, backdrop] = await Promise.all([
      cacheImage(movie.poster_path, 'w500', `${itemId}-poster`),
      cacheImage(movie.backdrop_path, 'w1280', `${itemId}-backdrop`)
    ]);
    return {
      type,
      tmdbId,
      title: movie.title,
      originalTitle: movie.original_title,
      year: yearOf(movie.release_date),
      overview,
      tagline: movie.tagline ?? '',
      poster,
      backdrop,
      rating: round1(movie.vote_average),
      voteCount: movie.vote_count ?? 0,
      runtime: movie.runtime || null,
      genres: normalizeGenres((movie.genres ?? []).map((genre) => genre.name)),
      keywords: (movie.keywords?.keywords ?? []).slice(0, 15).map((keyword) => keyword.name),
      cast: (movie.credits?.cast ?? []).slice(0, 12).map((person) => person.name),
      directors: (movie.credits?.crew ?? [])
        .filter((person) => person.job === 'Director')
        .map((person) => person.name)
        .slice(0, 3),
      trailer: pickTrailer(movie.videos?.results),
      updatedAt: nowIso()
    };
  }

  const show = await getTv(tmdbId);
  const overview = show.overview || (await getFallbackOverview('tv', tmdbId).catch(() => ''));
  const [poster, backdrop] = await Promise.all([
    cacheImage(show.poster_path, 'w500', `${itemId}-poster`),
    cacheImage(show.backdrop_path, 'w1280', `${itemId}-backdrop`)
  ]);
  return {
    type,
    tmdbId,
    title: show.name,
    originalTitle: show.original_name,
    year: yearOf(show.first_air_date),
    overview,
    tagline: show.tagline ?? '',
    poster,
    backdrop,
    rating: round1(show.vote_average),
    voteCount: show.vote_count ?? 0,
    runtime: show.episode_run_time?.[0] ?? show.last_episode_to_air?.runtime ?? null,
    genres: normalizeGenres((show.genres ?? []).map((genre) => genre.name)),
    keywords: (show.keywords?.results ?? []).slice(0, 15).map((keyword) => keyword.name),
    cast: (show.aggregate_credits?.cast ?? []).slice(0, 12).map((person) => person.name),
    directors: (show.created_by ?? []).map((person) => person.name).slice(0, 3),
    trailer: pickTrailer(show.videos?.results),
    updatedAt: nowIso()
  };
}

export async function fetchSeason(itemId: string, tmdbId: number, seasonNumber: number): Promise<SeasonMeta> {
  const season = await getSeason(tmdbId, seasonNumber);
  const episodes: Record<string, EpisodeMeta> = {};
  await Promise.all(
    (season.episodes ?? []).map(async (episode) => {
      episodes[String(episode.episode_number)] = {
        name: episode.name,
        overview: episode.overview ?? '',
        still: await cacheImage(episode.still_path, 'w300', `${itemId}-s${seasonNumber}e${episode.episode_number}`),
        airDate: episode.air_date ?? null,
        runtime: episode.runtime ?? null
      };
    })
  );
  return {
    name: season.name,
    overview: season.overview ?? '',
    poster: await cacheImage(season.poster_path, 'w500', `${itemId}-season${seasonNumber}`),
    episodes
  };
}
