import type { CatalogResponse, MediaFileDTO, MediaItem, MediaType, ScanStatus, StreamInfo } from '../types';
import { setBaseline } from './format';

export const UNAUTHORIZED_EVENT = 'alexprime:unauthorized';
export const VITRINE = __VITRINE__;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const EMPTY_STREAM_INFO: StreamInfo = {
  duration: null,
  videoCodec: null,
  audioCodec: null,
  width: null,
  height: null,
  audioLanguages: [],
  needsTranscode: false,
  transcodeAvailable: false,
  reason: ''
};

const downloadUrls = new Map<string, string>();

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { credentials: 'include', ...init, headers });
  if (response.status === 401 && !url.endsWith('/auth/login')) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!response.ok) {
    let message = `Erreur ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string; message?: string };
      message = body.error ?? body.message ?? message;
    } catch {
      message = response.statusText || message;
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

const unavailable = <T>(): Promise<T> => Promise.reject(new ApiError(400, 'Fonction disponible uniquement sur le serveur AlexFlix de la maison.'));

async function loadCatalog(): Promise<CatalogResponse> {
  const data = await request<CatalogResponse>(VITRINE ? '/catalog.json' : '/api/catalog', VITRINE ? { cache: 'no-cache' } : {});
  setBaseline(data.baselineAt);
  if (!VITRINE) return data;
  downloadUrls.clear();
  for (const item of data.items) for (const file of item.files) if (file.downloadUrl) downloadUrls.set(file.id, file.downloadUrl);
  return data;
}

export const api = {
  login: (password: string) =>
    VITRINE
      ? unavailable<{ token: string; expiresIn: number }>()
      : request<{ token: string; expiresIn: number }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: (): Promise<{ ok: boolean }> => {
    if (VITRINE) {
      window.location.assign('/__logout');
      return new Promise(() => undefined);
    }
    return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
  },
  me: () =>
    VITRINE ? Promise.resolve({ authenticated: true, exp: 0 }) : request<{ authenticated: boolean; exp: number }>('/api/auth/me'),
  catalog: loadCatalog,
  scan: (full: boolean) =>
    VITRINE
      ? unavailable<{ started: boolean; status: ScanStatus }>()
      : request<{ started: boolean; status: ScanStatus }>('/api/scan', { method: 'POST', body: JSON.stringify({ full }) }),
  scanStatus: () => (VITRINE ? unavailable<ScanStatus>() : request<ScanStatus>('/api/scan/status')),
  streamInfo: (fileId: string) =>
    VITRINE ? Promise.resolve(EMPTY_STREAM_INFO) : request<StreamInfo>(`/api/stream/${encodeURIComponent(fileId)}/info`),
  match: (itemId: string, tmdbId: number, type: MediaType) =>
    VITRINE
      ? unavailable<MediaItem>()
      : request<MediaItem>(`/api/items/${encodeURIComponent(itemId)}/match`, {
          method: 'POST',
          body: JSON.stringify({ tmdbId, type })
        })
};

export const imageUrl = (name: string | null | undefined): string | null => {
  if (!name) return null;
  return VITRINE ? `/images/${encodeURIComponent(name)}` : `/api/images/${encodeURIComponent(name)}`;
};

export const streamUrl = (fileId: string): string =>
  VITRINE ? (downloadUrls.get(fileId) ?? '') : `/api/stream/${encodeURIComponent(fileId)}`;

export const transcodeUrl = (fileId: string, start: number): string =>
  `/api/stream/${encodeURIComponent(fileId)}/transcode?start=${Math.max(0, Math.floor(start))}`;

export const downloadUrl = (file: MediaFileDTO): string | null =>
  VITRINE ? (file.downloadUrl ?? null) : `/api/stream/${encodeURIComponent(file.id)}?download=1`;
