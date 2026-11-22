import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { Catalog, Facet, FileDTO, ItemDTO, MediaFile, MediaItem } from '../types.js';
import { normalizeKey, nowIso } from './utils.js';

export const ROOT_CATEGORY = 'Nouveautés';
/** Séries rangées hors des dossiers de genre (dossier Séries ou dossier propre). */
export const SERIES_CATEGORY = 'Autres séries';

/** Nom de dossier affiché comme catégorie : « DANCE - MUSIQUE » → « Dance - musique », « SF » conservé. */
export function prettyFolder(name: string): string {
  const clean = name.replace(/[\p{Extended_Pictographic}️]/gu, '').replace(/\s+/g, ' ').trim();
  if (clean.length <= 3) return clean.toUpperCase();
  if (clean === clean.toUpperCase()) {
    const lower = clean.toLocaleLowerCase('fr');
    return lower.charAt(0).toLocaleUpperCase('fr') + lower.slice(1);
  }
  return clean;
}

function topFolder(relPath: string): string | null {
  const parts = relPath.split('/');
  if (parts.length < 2) return null;
  if (normalizeKey(parts[0]) === normalizeKey(config.moviesDir) && parts.length > 2) return parts[1];
  return parts[0];
}

const SEASON_FOLDER = /^(saison|season|s)\s*\d+$/i;
const SMALL_WORDS = new Set(['a', 'à', 'au', 'aux', 'de', 'des', 'du', 'et', 'la', 'le', 'les', 'l', 'd', 'and', 'of', 'the', 'en']);
const ACRONYMS = new Set(['dc', 'dceu', 'mcu', 'sf', 'usa', 'fbi', 'cia']);

/** Dossier en MAJUSCULES → « Titre De Saga » (petits mots en minuscules sauf en tête). */
function collectionName(folder: string): string {
  const clean = folder.replace(/^\s*\d+\s*[-–.]\s*/, '').replace(/\s+/g, ' ').trim();
  if (clean !== clean.toUpperCase()) return clean;
  return clean
    .toLocaleLowerCase('fr')
    .replace(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu, (word, offset: number) => {
      if (ACRONYMS.has(word)) return word.toUpperCase();
      return offset > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toLocaleUpperCase('fr') + word.slice(1);
    });
}

/** Sous-dossiers sous la catégorie (sagas, collections) : « MARVEL/01 - LA SAGA DE L'INFINI » → « Marvel · La saga de l'infini ». */
function collectionOf(relPath: string): string {
  const parts = relPath.split('/').slice(0, -1);
  if (parts.length > 0 && normalizeKey(parts[0]) === normalizeKey(config.moviesDir)) parts.shift();
  return parts
    .slice(1)
    .filter((part) => !SEASON_FOLDER.test(part.trim()))
    .map(collectionName)
    .filter(Boolean)
    .join(' · ');
}

/**
 * Séries posées hors des dossiers de genre : classées d'après TMDB, sans rien déplacer sur le disque.
 * Franchise (mots-clés) → catégorie + rangée « Marvel · Séries » ; sinon 1er genre TMDB qui a un dossier.
 */
const FRANCHISES: Array<{ test: RegExp; folder: string; collection: string }> = [
  { test: /marvel cinematic universe|based on marvel comics/i, folder: 'fantastique', collection: 'Marvel · Séries' },
  { test: /dc universe|dc extended universe|based on dc comics/i, folder: 'fantastique', collection: 'DC Comics · Séries' }
];
const GENRE_FOLDERS: Record<string, string[]> = {
  'science fiction': ['sf'],
  'science fiction & fantastique': ['sf', 'fantastique'],
  fantastique: ['fantastique'],
  'action & aventure': ['action', 'aventure'],
  action: ['action'],
  aventure: ['aventure'],
  comedie: ['comedie'],
  drame: ['drame'],
  feuilleton: ['drame'],
  mystere: ['thriller'],
  crime: ['thriller'],
  thriller: ['thriller'],
  animation: ['animation'],
  musique: ['dance - musique'],
  guerre: ['histoire vraie'],
  'guerre & politique': ['histoire vraie'],
  histoire: ['histoire vraie'],
  documentaire: ['histoire vraie']
};

const key = (value: string): string => normalizeKey(value).replace(/-/g, ' ').replace(/\s+/g, ' ').trim();

function inferSeries(item: MediaItem, folders: Set<string>): { category: string; collection: string } | null {
  const byKey = new Map([...folders].map((folder) => [key(folder), folder]));
  const keywords = item.keywords.join(' | ');
  for (const franchise of FRANCHISES) {
    const folder = byKey.get(franchise.folder);
    if (folder && franchise.test.test(keywords)) return { category: prettyFolder(folder), collection: franchise.collection };
  }
  for (const genre of item.genres) {
    for (const target of GENRE_FOLDERS[key(genre)] ?? [key(genre)]) {
      const folder = byKey.get(key(target));
      if (folder) return { category: prettyFolder(folder), collection: '' };
    }
  }
  return null;
}

export function emptyCatalog(): Catalog {
  return { version: 1, updatedAt: nowIso(), items: {}, files: {}, lookups: {} };
}

function toFacets(counts: Map<string, number>): Facet[] {
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fr'));
}

export class CatalogStore {
  readonly file: string;
  private catalog: Catalog = emptyCatalog();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(readonly dataDir: string) {
    this.file = path.join(dataDir, 'catalog.json');
  }

  async load(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<Catalog>;
      if (parsed.version === 1) {
        this.catalog = {
          ...emptyCatalog(),
          ...parsed,
          items: parsed.items ?? {},
          files: parsed.files ?? {},
          lookups: parsed.lookups ?? {}
        } as Catalog;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        const backup = `${this.file}.corrupt-${Date.now()}`;
        await fs.rename(this.file, backup).catch(() => undefined);
        console.warn(`[store] catalog.json illisible, sauvegardé sous ${backup}`);
      }
    }
  }

  get data(): Catalog {
    return this.catalog;
  }

  /** Date de référence des nouveautés ; initialisée au dernier ajout existant si absente. */
  baselineAt(): string | null {
    if (!this.catalog.baselineAt) {
      const latest = Object.values(this.catalog.files).reduce<string>((max, file) => (file.addedAt > max ? file.addedAt : max), '');
      if (latest) this.catalog.baselineAt = latest;
    }
    return this.catalog.baselineAt ?? null;
  }

  replace(next: Catalog): void {
    this.catalog = next;
  }

  save(): Promise<void> {
    return this.write(this.catalog);
  }

  write(catalog: Catalog): Promise<void> {
    catalog.updatedAt = nowIso();
    const json = JSON.stringify(catalog);
    const tmp = `${this.file}.tmp`;
    const task = async (): Promise<void> => {
      await fs.mkdir(this.dataDir, { recursive: true });
      await fs.writeFile(tmp, json, 'utf8');
      try {
        await fs.rename(tmp, this.file);
      } catch {
        await fs.copyFile(tmp, this.file);
        await fs.rm(tmp, { force: true });
      }
    };
    this.writeChain = this.writeChain.then(task, task);
    return this.writeChain;
  }

  /** Dossiers de premier niveau contenant au moins un film = dossiers « catégorie » triés par l'utilisateur. */
  private categoryFolders(): Set<string> {
    const folders = new Set<string>();
    for (const file of Object.values(this.catalog.files)) {
      if (this.catalog.items[file.itemId]?.type !== 'movie') continue;
      const top = topFolder(file.relPath);
      if (top) folders.add(top);
    }
    return folders;
  }

  private categoryOf(file: MediaFile, item: MediaItem, folders: Set<string>): string {
    const top = topFolder(file.relPath);
    if (!top) return ROOT_CATEGORY;
    if (normalizeKey(top) === normalizeKey(config.seriesDir)) return SERIES_CATEGORY;
    if (item.type === 'tv' && !folders.has(top)) return inferSeries(item, folders)?.category ?? SERIES_CATEGORY;
    return prettyFolder(top);
  }

  private collectionFor(file: MediaFile, item: MediaItem, folders: Set<string>): string {
    const top = topFolder(file.relPath);
    if (item.type === 'tv' && top && !folders.has(top)) return inferSeries(item, folders)?.collection ?? '';
    return collectionOf(file.relPath);
  }

  toDTO(item: MediaItem, folders: Set<string> = this.categoryFolders()): ItemDTO {
    const categories = [
      ...new Set(
        item.fileIds
          .map((id) => this.catalog.files[id])
          .filter((file) => file !== undefined)
          .map((file) => this.categoryOf(file, item, folders))
      )
    ];
    const files: FileDTO[] = item.fileIds
      .map((id) => this.catalog.files[id])
      .filter((file) => file !== undefined)
      .map((file) => ({
        id: file.id,
        name: path.posix.basename(file.relPath),
        ext: file.ext,
        size: file.size,
        season: file.season,
        episode: file.episode,
        addedAt: file.addedAt
      }))
      .sort(
        (a, b) =>
          (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0) || a.name.localeCompare(b.name, 'fr')
      );
    const collections = [
      ...new Set(
        item.fileIds
          .map((id) => this.catalog.files[id])
          .filter((file) => file !== undefined)
          .map((file) => this.collectionFor(file, item, folders))
          .filter(Boolean)
      )
    ];
    const { fileIds: _fileIds, ...rest } = item;
    return { ...rest, files, categories, collections };
  }

  list(): ItemDTO[] {
    const folders = this.categoryFolders();
    return Object.values(this.catalog.items)
      .filter((item) => item.fileIds.length > 0)
      .map((item) => this.toDTO(item, folders))
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }

  facets(): { genres: Facet[]; keywords: Facet[] } {
    const genres = new Map<string, number>();
    const keywords = new Map<string, number>();
    for (const item of Object.values(this.catalog.items)) {
      if (item.fileIds.length === 0) continue;
      for (const genre of item.genres) genres.set(genre, (genres.get(genre) ?? 0) + 1);
      for (const keyword of item.keywords) keywords.set(keyword, (keywords.get(keyword) ?? 0) + 1);
    }
    return {
      genres: toFacets(genres),
      keywords: toFacets(keywords).filter((facet) => facet.count >= 2).slice(0, 60)
    };
  }
}
