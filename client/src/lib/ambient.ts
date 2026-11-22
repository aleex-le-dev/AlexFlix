import { useSyncExternalStore } from 'react';

/** Image d'ambiance de la page : la pochette survolée, floutée en fond (store minimal, sans re-rendu des rangées). */

let current: string | null = null;
let clearTimer = 0;
const listeners = new Set<() => void>();

function emit(value: string | null): void {
  if (value === current) return;
  current = value;
  for (const listener of listeners) listener();
}

export function showAmbient(url: string | null): void {
  window.clearTimeout(clearTimer);
  if (url) emit(url);
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

export const useAmbient = (): string | null => useSyncExternalStore(subscribe, () => current);
