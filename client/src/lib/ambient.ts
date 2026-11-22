import { useSyncExternalStore } from 'react';

/**
 * Fond d'ambiance de la page : la pochette survolée, floutée, ou — pour les films de saga —
 * sa bande-annonce YouTube (store minimal, sans re-rendu des rangées).
 */
export interface Ambient {
  image: string;
  /** Clé YouTube de la bande-annonce à jouer en fond (rangées de saga). */
  trailer: string | null;
}

let current: Ambient | null = null;
let clearTimer = 0;
const listeners = new Set<() => void>();

function emit(value: Ambient | null): void {
  if (value?.image === current?.image && value?.trailer === current?.trailer) return;
  current = value;
  for (const listener of listeners) listener();
}

export function showAmbient(image: string | null, trailer: string | null = null): void {
  window.clearTimeout(clearTimer);
  if (image) emit({ image, trailer });
}

/** Petit délai : passer d'une carte à la voisine ne fait pas clignoter le fond. */
export function hideAmbient(): void {
  window.clearTimeout(clearTimer);
  clearTimer = window.setTimeout(() => emit(null), 250);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useAmbient = (): Ambient | null => useSyncExternalStore(subscribe, () => current);
