import { useEffect, useState } from 'react';
import { getFavorites, getProgressMap, STORAGE_EVENT, type ProgressEntry } from '../lib/storage';

function useStorageValue<T>(getter: () => T): T {
  const [value, setValue] = useState<T>(getter);
  useEffect(() => {
    const update = (): void => setValue(getter());
    window.addEventListener(STORAGE_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(STORAGE_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, [getter]);
  return value;
}

export const useFavorites = (): string[] => useStorageValue(getFavorites);

export const useProgress = (): Record<string, ProgressEntry> => useStorageValue(getProgressMap);
