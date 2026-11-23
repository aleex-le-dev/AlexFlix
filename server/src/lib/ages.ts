/**
 * Âge minimal conseillé de chaque titre (profil Enfants), d'après TMDB :
 * classification française en priorité (Tous publics / -10 / -12 / -16 / -18), sinon américaine convertie.
 * Mis en cache dans data/ages.json (null = inconnu) ; seuls les nouveaux titres sont interrogés.
 */
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { MediaItem } from '../types.js';
import { createLimiter } from './limiter.js';
import { tmdbEnabled, tmdbRequest } from './tmdb.js';

const agesFile = (): string => path.join(config.dataDir, 'ages.json');

const US_AGES: Record<string, number> = {
  G: 0, PG: 10, 'PG-13': 12, R: 16, 'NC-17': 18,
  'TV-Y': 0, 'TV-Y7': 7, 'TV-G': 0, 'TV-PG': 10, 'TV-14': 12, 'TV-MA': 16
};

function frenchAge(value: string | undefined): number | null {
  const label = (value ?? '').trim().toUpperCase();
  if (!label) return null;
  if (['U', 'TP', 'TOUS PUBLICS', 'ALL', '0'].includes(label)) return 0;
  const age = Number.parseInt(label.replace(/\D/g, ''), 10);
  return Number.isFinite(age) ? age : null;
}

export interface Ages {
  /** Classification française (âge minimal) ; null = inconnue. */
  fr: number | null;
  /** Classification américaine convertie (G = 0, PG = 10, PG-13 = 12…) ; null = inconnue. */
  us: number | null;
}

async function fetchAges(item: MediaItem): Promise<Ages> {
  if (item.type === 'movie') {
    const data = await tmdbRequest<{ results?: Array<{ iso_3166_1: string; release_dates: Array<{ certification: string }> }> }>(
      `/movie/${item.tmdbId}/release_dates`
    );
    const pick = (country: string): string[] =>
      (data.results ?? []).find((entry) => entry.iso_3166_1 === country)?.release_dates.map((date) => date.certification).filter(Boolean) ?? [];
    const fr = pick('FR').map(frenchAge).filter((age): age is number => age !== null);
    const us = pick('US').map((label) => US_AGES[label]).filter((age): age is number => age !== undefined);
    return { fr: fr.length ? Math.max(...fr) : null, us: us.length ? Math.max(...us) : null };
  }
  const data = await tmdbRequest<{ results?: Array<{ iso_3166_1: string; rating: string }> }>(`/tv/${item.tmdbId}/content_ratings`);
  const rating = (country: string): string | undefined => (data.results ?? []).find((entry) => entry.iso_3166_1 === country)?.rating;
  return { fr: frenchAge(rating('FR')), us: US_AGES[rating('US') ?? ''] ?? null };
}

export async function loadAges(items: MediaItem[], log: (message: string) => void): Promise<Record<string, Ages>> {
  const raw: Record<string, unknown> = existsSync(agesFile()) ? JSON.parse(await fs.readFile(agesFile(), 'utf8')) : {};
  // Ancien format (un seul nombre) : ré-interrogé pour obtenir aussi la classification américaine.
  const ages: Record<string, Ages> = {};
  for (const [id, value] of Object.entries(raw)) if (value && typeof value === 'object') ages[id] = value as Ages;
  const missing = tmdbEnabled() ? items.filter((item) => item.tmdbId && !(item.id in ages)) : [];
  if (missing.length > 0) {
    log(`Classifications d'âge : ${missing.length} titre(s) à interroger sur TMDB…`);
    const limit = createLimiter(6);
    await Promise.all(
      missing.map((item) =>
        limit(async () => {
          try {
            ages[item.id] = await fetchAges(item);
          } catch {
            // réessayé au prochain deploy
          }
        })
      )
    );
    await fs.writeFile(agesFile(), JSON.stringify(ages, null, 2));
  }
  return ages;
}
