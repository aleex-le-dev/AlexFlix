export type MediaType = 'movie' | 'tv';

export interface EpisodeMeta {
  name: string;
  overview: string;
  still: string | null;
  airDate: string | null;
  runtime: number | null;
}

export interface SeasonMeta {
  name: string;
  overview: string;
  poster: string | null;
  episodes: Record<string, EpisodeMeta>;
}

export interface MediaItem {
  id: string;
  type: MediaType;
  tmdbId: number | null;
  title: string;
  originalTitle: string;
  year: number | null;
  overview: string;
  tagline: string;
  poster: string | null;
  backdrop: string | null;
  rating: number;
  voteCount: number;
  runtime: number | null;
  genres: string[];
  keywords: string[];
  cast: string[];
  directors: string[];
  trailer: string | null;
  seasons: Record<string, SeasonMeta>;
  fileIds: string[];
  addedAt: string;
  updatedAt: string;
}

export interface MediaFile {
  id: string;
  relPath: string;
  size: number;
  mtimeMs: number;
  ext: string;
  itemId: string;
  lookupKey: string;
  season: number | null;
  episode: number | null;
  addedAt: string;
}

export interface LookupEntry {
  tmdbId: number | null;
  type?: MediaType;
  at: string;
  manual?: boolean;
}

export interface Catalog {
  version: 1;
  updatedAt: string;
  /** Fin de l'import initial : seuls les fichiers ajoutés après comptent comme « récemment ajoutés ». */
  baselineAt?: string;
  items: Record<string, MediaItem>;
  files: Record<string, MediaFile>;
  lookups: Record<string, LookupEntry>;
}

export interface ParsedName {
  type: MediaType;
  title: string;
  year: number | null;
  season: number | null;
  episode: number | null;
}

export type ScanPhase = 'idle' | 'walking' | 'matching' | 'saving' | 'done' | 'error';

export interface ScanStatus {
  running: boolean;
  phase: ScanPhase;
  full: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  filesFound: number;
  newFiles: number;
  removedFiles: number;
  processed: number;
  itemsTotal: number;
  errors: string[];
  lastError: string | null;
}

export interface FileDTO {
  id: string;
  name: string;
  ext: string;
  size: number;
  season: number | null;
  episode: number | null;
  addedAt: string;
}

export type ItemDTO = Omit<MediaItem, 'fileIds'> & { files: FileDTO[]; categories: string[]; collections: string[] };

export interface Facet {
  name: string;
  count: number;
}
