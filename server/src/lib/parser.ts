import path from 'node:path';
import type { ParsedName } from '../types.js';
import { normalizeKey } from './utils.js';

const STRONG_TOKENS = new Set([
  '2160p', '1440p', '1080p', '1080i', '720p', '576p', '480p', '360p', '4k', '8k', 'uhd',
  'hdr', 'hdr10', 'hdr10+', 'dv', 'dovi', 'sdr',
  'bluray', 'blu-ray', 'bdrip', 'brrip', 'bdremux', 'remux', 'webdl', 'web-dl', 'webrip', 'hdtv', 'hdrip',
  'dvdrip', 'dvd', 'dvdscr', 'dvd5', 'dvd9', 'hdcam', 'tvrip', 'pdtv',
  'x264', 'x265', 'h264', 'h265', 'hevc', 'avc', 'av1', 'xvid', 'divx', 'vc1', '10bit', '10-bit', '8bit',
  'aac', 'aac2', 'ac3', 'eac3', 'dd', 'ddp', 'dd5', 'ddp5', 'dd2', 'dts', 'dts-hd', 'dtshd', 'truehd', 'atmos', 'flac', 'mp3', 'opus',
  'nf', 'amzn', 'dsnp', 'hmax', 'atvp', 'pmtp', 'hulu', 'cr'
]);

const WEAK_TOKENS = new Set([
  'multi', 'multi-vf', 'multi-vff', 'vff', 'vfq', 'vfi', 'vf', 'vf2', 'vo', 'vost', 'vostfr', 'subfrench', 'french',
  'truefrench', 'english', 'fr', 'en', 'proper', 'repack', 'extended', 'unrated', 'remastered', 'imax', 'uncut', 'custom',
  'integrale', 'intégrale', 'complete', 'directors', 'dc', 'theatrical', 'hybrid', 'limited', 'internal', 'dubbed',
  'light', 'mhd', 'hdlight', '4klight', 'fhd', 'hd'
]);

const YEAR_RE = /^(19\d{2}|20\d{2})$/;
const SE_RE = /\bS(\d{1,2})\s?[EÉ](\d{1,3})(?:\s?-?\s?E\d{1,3})*/i;
const X_RE = /\b(\d{1,2})x(\d{2,3})\b/i;
const SEASON_DIR_RE = /^(?:saison|season|series|s)\s*0*(\d{1,2})(?:\s.*)?$/i;
const EPISODE_RE = /\b(?:e|ep|episode|épisode)\s?(\d{1,3})\b/i;
const LEADING_EPISODE_RE = /^(\d{1,3})(?:\s|-|$)/;

function tokenize(raw: string): string[] {
  let value = raw.normalize('NFC');
  value = value.replace(/\[[^\]]*\]|\{[^}]*\}/g, ' ');
  value = value.replace(/\((\d{4})\)/g, ' $1 ');
  value = value.replace(/\([^)]*\)/g, ' ');
  value = value.replace(/\b([hx])[ .]?(26[45])\b/gi, '$1$2');
  value = value.replace(/[._]+/g, ' ');
  value = value.replace(/\s[-–—]+\s/g, ' ');
  return value
    .split(/\s+/)
    .map((token) => token.replace(/^[-–—,;:]+|[-–—,;:]+$/g, ''))
    .filter(Boolean);
}

const matches = (set: Set<string>, token: string): boolean => set.has(token) || set.has(token.split('-')[0]);

export function cleanTitle(raw: string): { title: string; year: number | null } {
  const tokens = tokenize(raw);
  const lower = tokens.map((token) => token.toLowerCase());
  const maxYear = new Date().getFullYear() + 1;

  let strongIndex = tokens.length;
  for (let i = 1; i < tokens.length; i++) {
    if (matches(STRONG_TOKENS, lower[i])) {
      strongIndex = i;
      break;
    }
  }

  let yearIndex = -1;
  for (let i = 1; i < strongIndex; i++) {
    if (YEAR_RE.test(tokens[i]) && Number(tokens[i]) <= maxYear) yearIndex = i;
  }

  let cut = strongIndex;
  if (yearIndex >= 0) {
    cut = yearIndex;
  } else {
    for (let i = 1; i < strongIndex; i++) {
      if (matches(WEAK_TOKENS, lower[i])) {
        cut = i;
        break;
      }
    }
  }

  const titleTokens = tokens.slice(0, cut);
  while (titleTokens.length > 1 && matches(WEAK_TOKENS, titleTokens[titleTokens.length - 1].toLowerCase())) {
    titleTokens.pop();
  }

  // « Gladiator 1 2000 », « Venom 1 (2018) » : le « 1 » final (premier volet) fausse la recherche TMDB.
  if (titleTokens.length > 1 && titleTokens[titleTokens.length - 1] === '1') titleTokens.pop();
  const title = titleTokens.join(' ').trim() || tokens.join(' ').trim();
  return { title, year: yearIndex >= 0 ? Number(tokens[yearIndex]) : null };
}

const spaced = (value: string): string => value.replace(/[._]+/g, ' ').trim();

export function parseMediaPath(relPath: string, moviesDir: string, seriesDir: string): ParsedName {
  const parts = relPath.split('/');
  const fileName = parts[parts.length - 1];
  const base = fileName.slice(0, fileName.length - path.extname(fileName).length);
  const baseSpaced = spaced(base);
  const top = parts.length > 1 ? normalizeKey(parts[0]) : '';
  const inSeries = top !== '' && top === normalizeKey(seriesDir);
  const inMovies = top !== '' && top === normalizeKey(moviesDir);
  const dirs = parts.slice(inSeries || inMovies ? 1 : 0, -1);
  const sagaDepth = inMovies ? 1 : 2;
  const se = SE_RE.exec(baseSpaced) ?? X_RE.exec(baseSpaced);
  const seasonDirIndex = dirs.findIndex((dir) => SEASON_DIR_RE.test(spaced(dir)));

  if (se || inSeries || (seasonDirIndex >= 0 && !inMovies)) {
    let season = se ? Number(se[1]) : null;
    let episode = se ? Number(se[2]) : null;
    if (season === null && seasonDirIndex >= 0) {
      const seasonMatch = SEASON_DIR_RE.exec(spaced(dirs[seasonDirIndex]));
      if (seasonMatch) season = Number(seasonMatch[1]);
    }
    if (episode === null) {
      const episodeMatch = EPISODE_RE.exec(baseSpaced) ?? LEADING_EPISODE_RE.exec(baseSpaced);
      if (episodeMatch) episode = Number(episodeMatch[1]);
    }

    const showDirs = dirs.filter((dir) => !SEASON_DIR_RE.test(spaced(dir)));
    let source: string;
    if (inSeries && showDirs.length > 0) source = showDirs[0];
    else if (se && se.index > 0) source = baseSpaced.slice(0, se.index);
    else if (showDirs.length > 0) source = showDirs[showDirs.length - 1];
    else source = baseSpaced;

    const cleaned = cleanTitle(source);
    return {
      type: 'tv',
      title: cleaned.title || cleanTitle(baseSpaced).title || base,
      year: cleaned.year,
      season: episode !== null ? (season ?? 1) : season,
      episode
    };
  }

  const inSaga = dirs.length >= sagaDepth;
  const own = cleanTitle(inSaga ? base.replace(/^\d{1,2}[\s._-]+(?=\D)/, '') : base);
  const parent = dirs.length > 0 ? dirs[dirs.length - 1] : null;
  if (parent && own.year === null) {
    const fromParent = cleanTitle(parent);
    if (fromParent.year !== null) return { type: 'movie', title: fromParent.title, year: fromParent.year, season: null, episode: null };
  }
  return { type: 'movie', title: own.title || base, year: own.year, season: null, episode: null };
}

export function lookupKeyOf(parsed: ParsedName): string {
  return `${parsed.type}|${normalizeKey(parsed.title)}|${parsed.year ?? ''}`;
}
