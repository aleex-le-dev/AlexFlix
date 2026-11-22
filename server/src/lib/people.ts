import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { MediaItem } from '../types.js';
import { cacheImage } from './images.js';
import { tmdbEnabled, tmdbRequest } from './tmdb.js';
import { errorMessage } from './utils.js';

/** Visage proposé comme avatar de profil (acteur principal d'un film du catalogue). */
export interface PersonAvatar {
  image: string;
  name: string;
  character: string;
  film: string;
}

interface PeopleCache {
  generatedAt: string;
  people: PersonAvatar[];
}

interface CastMember {
  id: number;
  name: string;
  profile_path: string | null;
  character?: string;
  roles?: Array<{ character?: string }>;
}

const peopleFile = (): string => path.join(config.dataDir, 'people.json');
const MAX_FILMS = 40;
const PER_FILM = 2;
const MAX_PEOPLE = 60;
const REFRESH_MS = 30 * 24 * 3600 * 1000;

export async function readPeople(): Promise<PersonAvatar[]> {
  try {
    return ((JSON.parse(await fs.readFile(peopleFile(), 'utf8')) as PeopleCache).people ?? []).filter((person) => person.image);
  } catch {
    return [];
  }
}

/** Construit (ou réutilise, < 30 jours) la sélection de visages à partir des films les mieux notés. */
export async function ensurePeople(items: MediaItem[], log: (message: string) => void): Promise<PersonAvatar[]> {
  try {
    const cached = JSON.parse(await fs.readFile(peopleFile(), 'utf8')) as PeopleCache;
    if (Date.now() - Date.parse(cached.generatedAt) < REFRESH_MS && cached.people.length > 0) return cached.people;
  } catch {
    log('Sélection des visages pour les avatars de profil…');
  }
  if (!tmdbEnabled()) return [];

  const films = items
    .filter((item) => item.tmdbId !== null)
    .sort((a, b) => b.rating * Math.log10(b.voteCount + 10) - a.rating * Math.log10(a.voteCount + 10))
    .slice(0, MAX_FILMS);

  const seen = new Set<number>();
  const people: PersonAvatar[] = [];
  for (const film of films) {
    if (people.length >= MAX_PEOPLE) break;
    try {
      const endpoint = film.type === 'movie' ? `/movie/${film.tmdbId}/credits` : `/tv/${film.tmdbId}/aggregate_credits`;
      const credits = await tmdbRequest<{ cast?: CastMember[] }>(endpoint);
      let added = 0;
      for (const member of credits.cast ?? []) {
        if (added >= PER_FILM || people.length >= MAX_PEOPLE) break;
        if (!member.profile_path || seen.has(member.id)) continue;
        const image = await cacheImage(member.profile_path, 'w185', `person-${member.id}`);
        if (!image) continue;
        seen.add(member.id);
        people.push({ image, name: member.name, character: member.character ?? member.roles?.[0]?.character ?? '', film: film.title });
        added++;
      }
    } catch (error) {
      log(`Visages indisponibles pour « ${film.title} » : ${errorMessage(error)}`);
    }
  }

  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(peopleFile(), JSON.stringify({ generatedAt: new Date().toISOString(), people } satisfies PeopleCache, null, 2));
  log(`${people.length} visages prêts pour les avatars.`);
  return people;
}
