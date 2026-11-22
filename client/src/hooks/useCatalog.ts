import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { CatalogResponse } from '../types';

export function useCatalog(): {
  data: CatalogResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
} {
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await api.catalog());
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Erreur de chargement du catalogue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}
