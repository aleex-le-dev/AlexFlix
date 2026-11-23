import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { MediaItem } from '../types.js';
import { cacheImage } from './images.js';
import { tmdbEnabled, tmdbRequest } from './tmdb.js';
import { errorMessage } from './utils.js';

/** Visage proposé comme avatar de profil, rangé par saga (« Harry Potter », « Star Wars »…) ou « Films cultes ». */
export interface PersonAvatar {
  image: string;
  name: string;
  character: string;
  film: string;
  group: string;
}

interface PeopleCache {
  version: number;
  generatedAt: string;
  people: PersonAvatar[];
}

interface CastMember {
  id: number;
  name: string;
  profile_path: string | null;
  character?: string;
  roles?: Array<{ character?: string }>;
  order?: number;
}

/** Titre du catalogue avec sa saga (sous-dossier du disque), tel que publié. */
export type PeopleSource = Pick<MediaItem, 'tmdbId' | 'type' | 'title' | 'rating' | 'voteCount'> & { collections?: string[] };

const VERSION = 3;
const peopleFile = (): string => path.join(config.dataDir, 'people.json');
const MAX_SAGAS = 16;
const PER_SAGA = 8;
const CAST_PER_FILM = 6;
const CULT_FILMS = 16;
const PER_CULT_FILM = 2;
const REFRESH_MS = 30 * 24 * 3600 * 1000;
export const CULT_GROUP = 'Films cultes';

export async function readPeople(): Promise<PersonAvatar[]> {
  try {
    return ((JSON.parse(await fs.readFile(peopleFile(), 'utf8')) as PeopleCache).people ?? []).filter((person) => person.image);
  } catch {
    return [];
  }
}

const score = (item: PeopleSource): number => item.rating * Math.log10(item.voteCount + 10);

async function castOf(item: PeopleSource): Promise<CastMember[]> {
  const endpoint = item.type === 'movie' ? `/movie/${item.tmdbId}/credits` : `/tv/${item.tmdbId}/aggregate_credits`;
  const credits = await tmdbRequest<{ cast?: CastMember[] }>(endpoint);
  return (credits.cast ?? []).filter((member) => member.profile_path);
}

/**
 * Construit (ou réutilise, < 30 jours) les visages : pour chaque saga du disque, les acteurs qui reviennent
 * le plus dans ses films ; puis 2 acteurs par grand film hors saga.
 */
export async function ensurePeople(items: PeopleSource[], log: (message: string) => void): Promise<PersonAvatar[]> {
  try {
    const cached = JSON.parse(await fs.readFile(peopleFile(), 'utf8')) as PeopleCache;
    if (cached.version === VERSION && Date.now() - Date.parse(cached.generatedAt) < REFRESH_MS && cached.people.length > 0) return cached.people;
  } catch {
    // première génération
  }
  if (!tmdbEnabled()) return [];
  log('Sélection des visages par saga pour les avatars de profil…');

  const withTmdb = items.filter((item) => item.tmdbId !== null);
  const sagas = new Map<string, PeopleSource[]>();
  for (const item of withTmdb) {
    const saga = item.collections?.[0];
    if (saga) sagas.set(saga, [...(sagas.get(saga) ?? []), item]);
  }
  const rankedSagas = [...sagas]
    .filter(([, films]) => films.length >= 2)
    .sort((a, b) => b[1].reduce((sum, film) => sum + score(film), 0) - a[1].reduce((sum, film) => sum + score(film), 0))
    .slice(0, MAX_SAGAS);

  const seen = new Set<number>();
  const people: PersonAvatar[] = [];
  const add = async (member: CastMember, film: PeopleSource, group: string): Promise<boolean> => {
    if (seen.has(member.id) || !member.profile_path) return false;
    const image = await cacheImage(member.profile_path, 'w185', `person-${member.id}`);
    if (!image) return false;
    seen.add(member.id);
    people.push({ image, name: member.name, character: member.character ?? member.roles?.[0]?.character ?? '', film: film.title, group });
    return true;
  };

  for (const [saga, films] of rankedSagas) {
    const group = saga;
    // Acteurs présents dans le plus de films de la saga, puis les mieux crédités.
    const tally = new Map<number, { member: CastMember; film: PeopleSource; count: number; best: number }>();
    for (const film of films) {
      try {
        for (const member of (await castOf(film)).slice(0, CAST_PER_FILM)) {
          const entry = tally.get(member.id) ?? { member, film, count: 0, best: 99 };
          entry.count++;
          entry.best = Math.min(entry.best, member.order ?? 99);
          tally.set(member.id, entry);
        }
      } catch (error) {
        log(`Visages indisponibles pour « ${film.title} » : ${errorMessage(error)}`);
      }
    }
    let added = 0;
    for (const entry of [...tally.values()].sort((a, b) => b.count - a.count || a.best - b.best)) {
      if (added >= PER_SAGA) break;
      if (await add(entry.member, entry.film, group)) added++;
    }
  }

  const cult = withTmdb.filter((item) => !item.collections?.[0]).sort((a, b) => score(b) - score(a)).slice(0, CULT_FILMS);
  for (const film of cult) {
    try {
      let added = 0;
      for (const member of await castOf(film)) {
        if (added >= PER_CULT_FILM) break;
        if (await add(member, film, CULT_GROUP)) added++;
      }
    } catch (error) {
      log(`Visages indisponibles pour « ${film.title} » : ${errorMessage(error)}`);
    }
  }

  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(peopleFile(), JSON.stringify({ version: VERSION, generatedAt: new Date().toISOString(), people } satisfies PeopleCache, null, 2));
  log(`${people.length} visages prêts (${rankedSagas.length} sagas + films cultes).`);
  return people;
}
