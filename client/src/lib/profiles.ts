import type { AvatarId, Profile } from '../types';
import { clearProfileData, hydrateProfile, readProfileData, setActiveProfile, setSyncHandlers, type ProgressEntry } from './storage';

/**
 * Profils + données par profil (Ma liste, reprise).
 * Vitrine en ligne : stockés côté hébergeur via gate.php (/__api/*) → synchronisés entre appareils.
 * Serveur maison : stockés dans le navigateur.
 */

export const AVATARS: AvatarId[] = ['bounty', 'red', 'blue', 'yellow', 'green', 'purple', 'pink'];
export const MAX_PROFILES = 5;
export const DEFAULT_PROFILES: Profile[] = [{ id: 'alex', name: 'Alex', avatar: 'bounty' }];

const REMOTE = __VITRINE__;
const PROFILES_KEY = 'alexprime:profiles';
const SELECTED_KEY = 'alexprime:profile';

interface RemoteState {
  profiles?: Profile[];
  data?: Record<string, { favorites?: string[]; progress?: Record<string, ProgressEntry> }> | unknown[];
}

let remoteState: RemoteState | null = null;
const pendingProgress = new Map<string, Map<string, ProgressEntry>>();
let flushTimer = 0;

async function post(path: string, body: unknown, keepalive = false): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    keepalive,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    let message = `Erreur ${response.status}`;
    try {
      message = ((await response.json()) as { error?: string }).error ?? message;
    } catch {
      message = response.statusText || message;
    }
    throw new Error(message);
  }
}

function flushProgress(keepalive = false): void {
  window.clearTimeout(flushTimer);
  for (const [profile, entries] of pendingProgress) {
    if (entries.size === 0) continue;
    void post('/__api/progress', { profile, entries: [...entries.values()] }, keepalive).catch(() => undefined);
  }
  pendingProgress.clear();
}

if (REMOTE) {
  setSyncHandlers({
    favorites: (profile, favorites) => {
      void post('/__api/favorites', { profile, favorites }).catch(() => undefined);
    },
    progress: (profile, entry) => {
      const entries = pendingProgress.get(profile) ?? new Map<string, ProgressEntry>();
      entries.set(entry.fileId, entry);
      pendingProgress.set(profile, entries);
      window.clearTimeout(flushTimer);
      flushTimer = window.setTimeout(() => flushProgress(), 8000);
    }
  });
  window.addEventListener('pagehide', () => flushProgress(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushProgress(true);
  });
}

function readLocalProfiles(): Profile[] {
  try {
    const list = JSON.parse(localStorage.getItem(PROFILES_KEY) ?? 'null') as Profile[] | null;
    return Array.isArray(list) && list.length > 0 ? list : DEFAULT_PROFILES;
  } catch {
    return DEFAULT_PROFILES;
  }
}

function writeLocalProfiles(list: Profile[]): void {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(list));
  } catch {
    return;
  }
}

export async function loadProfiles(): Promise<Profile[]> {
  if (REMOTE) {
    try {
      const response = await fetch('/__api/state', { cache: 'no-store', credentials: 'include' });
      if (response.ok) {
        remoteState = (await response.json()) as RemoteState;
        const list = remoteState.profiles?.length ? remoteState.profiles : DEFAULT_PROFILES;
        writeLocalProfiles(list);
        return list;
      }
    } catch {
      return readLocalProfiles();
    }
  }
  return readLocalProfiles();
}

export async function saveProfiles(list: Profile[], removed: string[] = []): Promise<void> {
  if (REMOTE) await post('/__api/profiles', { profiles: list });
  writeLocalProfiles(list);
  for (const id of removed) clearProfileData(id);
}

export function activateProfile(profileId: string): void {
  flushProgress();
  if (REMOTE && remoteState) {
    const data = remoteState.data && !Array.isArray(remoteState.data) ? remoteState.data[profileId] : undefined;
    if (data) {
      hydrateProfile(profileId, data.favorites ?? [], data.progress ?? {});
    } else {
      const local = readProfileData(profileId);
      if (local.favorites.length > 0) void post('/__api/favorites', { profile: profileId, favorites: local.favorites }).catch(() => undefined);
      const entries = Object.values(local.progress).slice(0, 100);
      if (entries.length > 0) void post('/__api/progress', { profile: profileId, entries }).catch(() => undefined);
    }
  }
  setActiveProfile(profileId);
}

export function readSelectedProfile(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('profil');
    if (fromUrl) {
      sessionStorage.setItem(SELECTED_KEY, fromUrl);
      params.delete('profil');
      const search = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}`);
      return fromUrl;
    }
    return sessionStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
}

export function writeSelectedProfile(profileId: string | null): void {
  try {
    if (profileId) sessionStorage.setItem(SELECTED_KEY, profileId);
    else sessionStorage.removeItem(SELECTED_KEY);
  } catch {
    return;
  }
}

/** Recadre l'image en carré 256×256 JPEG dans le navigateur (photos lourdes, EXIF retiré). */
export async function prepareAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choisissez un fichier image.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Format d’image non pris en charge (utilisez JPG, PNG ou WebP).');
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Traitement de l’image impossible.');
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.88);
}

/** Enregistre l'image : sur l'hébergeur en ligne (renvoie `custom:<hash>`), en local sinon (data URL). */
export async function uploadAvatar(dataUrl: string): Promise<string> {
  if (!REMOTE) return dataUrl;
  const response = await fetch('/__api/avatar', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl })
  });
  const body = (await response.json().catch(() => ({}))) as { avatar?: string; error?: string };
  if (!response.ok || !body.avatar) throw new Error(body.error ?? 'Envoi de l’image impossible.');
  return body.avatar;
}

/** Images importées disponibles sur l'hébergeur (les plus récentes d'abord). */
export async function listAvatars(): Promise<string[]> {
  if (!REMOTE) return [];
  try {
    const response = await fetch('/__api/avatars', { cache: 'no-store', credentials: 'include' });
    if (!response.ok) return [];
    return ((await response.json()) as { avatars?: string[] }).avatars ?? [];
  } catch {
    return [];
  }
}

/** Supprime une image importée ; les profils qui l'utilisaient repassent sur l'avatar rouge. */
export async function deleteAvatar(avatar: string): Promise<void> {
  if (!REMOTE) return;
  await post('/__api/avatar-delete', { avatar });
}

export function newProfileId(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20);
  return `${slug || 'profil'}-${Date.now().toString(36).slice(-5)}`;
}

export { flushProgress };
