export type MediaType = 'movie' | 'tv';
export type Tab = 'home' | 'movies' | 'tv' | 'mylist';
export type ViewMode = 'rows' | 'grid';
export type HeroMode = 'banner' | 'coverflow';

export type AvatarId = 'bounty' | 'red' | 'blue' | 'yellow' | 'green' | 'purple' | 'pink';

export interface Profile {
  id: string;
  name: string;
  /** Avatar prédéfini, image importée (`custom:<hash>` en ligne) ou image locale (`data:` sur le serveur maison). */
  avatar: AvatarId | string;
  /** Profil Enfants : seulement les titres « Tous publics » / -10 (ou animation / familial si âge inconnu). */
  kids?: boolean;
}

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

export interface MediaFileDTO {
  id: string;
  name: string;
  ext: string;
  size: number;
  season: number | null;
  episode: number | null;
  addedAt: string;
  downloadUrl?: string | null;
  /** Piste son AAC séparée (vidéo en Dolby, illisible par le navigateur) — vitrine uniquement. */
  audioUrl?: string | null;
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
  /** Catégories = dossiers de premier niveau du disque Freebox (classement de l'utilisateur). */
  categories: string[];
  /** Âge minimal conseillé (classification TMDB FR, sinon US) ; null = inconnu. */
  age?: number | null;
  /** Classification américaine convertie (G = 0, PG = 10, PG-13 = 12) ; plus stricte, sert au profil Enfants. */
  ageUs?: number | null;
  /** Sous-dossiers sous la catégorie (sagas) : « Marvel · La Saga de l'Infini ». */
  collections?: string[];
  keywords: string[];
  cast: string[];
  directors: string[];
  trailer: string | null;
  seasons: Record<string, SeasonMeta>;
  files: MediaFileDTO[];
  addedAt: string;
  updatedAt: string;
}

export interface Facet {
  name: string;
  count: number;
}

export interface ScanStatus {
  running: boolean;
  phase: 'idle' | 'walking' | 'matching' | 'saving' | 'done' | 'error';
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

export interface PersonAvatar {
  image: string;
  name: string;
  character: string;
  film: string;
  /** Saga du disque (« Harry Potter », « Marvel · La Saga de l'Infini »…) ou « Films cultes ». */
  group?: string;
}

export interface CatalogResponse {
  updatedAt: string;
  people?: PersonAvatar[];
  baselineAt?: string | null;
  items: MediaItem[];
  genres: Facet[];
  keywords: Facet[];
  scan: ScanStatus;
  tmdbEnabled: boolean;
  transcodeAvailable: boolean;
}

export interface StreamInfo {
  duration: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  audioLanguages: string[];
  needsTranscode: boolean;
  transcodeAvailable: boolean;
  reason: string;
}

export interface RowFilter {
  genre?: string;
  theme?: string;
}

export interface RowDef {
  id: string;
  title: string;
  items: MediaItem[];
  filter?: RowFilter;
}
