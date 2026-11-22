import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { FolderSearch, RefreshCw } from 'lucide-react';
import type { MediaItem, RowFilter, ScanStatus, Tab } from '../types';
import { api } from '../lib/api';
import { buildRows, facetsOf, filterItems, pickFeatured, resumeFileId, sortSearchResults } from '../lib/catalog';
import { getProgressMap, toggleFavorite } from '../lib/storage';
import { useCatalog } from '../hooks/useCatalog';
import { useFavorites, useProgress } from '../hooks/useStorage';
import { Navbar } from '../components/Navbar';
import { Hero } from '../components/Hero';
import { Row } from '../components/Row';
import { Grid } from '../components/Grid';
import { DetailModal } from '../components/DetailModal';
import { Player } from '../components/Player';
import { ScanToast } from '../components/ScanToast';
import { BrowseSkeleton } from '../components/Skeletons';
import { Logo } from '../components/Logo';

const TAB_TITLES: Record<Tab, string> = {
  home: 'Tout le catalogue',
  movies: 'Films',
  tv: 'Séries',
  mylist: 'Ma liste'
};

const TABS: Tab[] = ['home', 'movies', 'tv', 'mylist'];

/** État de navigation conservé dans l'adresse (?onglet=&categorie=&q=&titre=) pour survivre à une actualisation. */
function readUrlState(): { tab: Tab; query: string; genre: string | null; selected: string | null } {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('onglet') as Tab | null;
  return {
    tab: tab && TABS.includes(tab) ? tab : 'home',
    query: params.get('q') ?? '',
    genre: params.get('categorie'),
    selected: params.get('titre')
  };
}

export function Browse({ onLogout }: { onLogout: () => void }) {
  const [initial] = useState(readUrlState);
  const { data, loading, error, reload } = useCatalog();
  const favorites = useFavorites();
  const progress = useProgress();
  const [tab, setTab] = useState<Tab>(initial.tab);
  const [query, setQuery] = useState(initial.query);
  const deferredQuery = useDeferredValue(query);
  const [genre, setGenre] = useState<string | null>(initial.genre);
  const [selectedId, setSelectedId] = useState<string | null>(initial.selected);
  const [playing, setPlaying] = useState<{ itemId: string; fileId: string } | null>(null);
  const [scan, setScan] = useState<ScanStatus | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (tab !== 'home') params.set('onglet', tab);
    if (genre) params.set('categorie', genre);
    if (query.trim()) params.set('q', query);
    if (selectedId) params.set('titre', selectedId);
    const search = params.toString();
    const next = `${window.location.pathname}${search ? `?${search}` : ''}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', next);
  }, [tab, genre, query, selectedId]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const tabItems = useMemo(
    () => filterItems(items, { tab, genre: null, theme: null, query: '', favorites }),
    [items, tab, favorites]
  );
  const facets = useMemo(() => facetsOf(tabItems), [tabItems]);
  const filtered = useMemo(
    () => filterItems(tabItems, { tab: 'home', genre, theme: null, query: deferredQuery, favorites }),
    [tabItems, genre, deferredQuery, favorites]
  );
  const featured = useMemo(() => pickFeatured(filtered), [filtered]);
  const rows = useMemo(
    () => buildRows(filtered, { progress, favorites, activeGenre: genre, activeTheme: null }),
    [filtered, progress, favorites, genre]
  );

  const searching = deferredQuery.trim().length > 0;
  const showGrid = searching || tab === 'mylist';
  const showHero = !showGrid && featured.length > 0;

  useEffect(() => {
    if (data?.scan) setScan(data.scan);
  }, [data]);

  useEffect(() => {
    if (!scan?.running) return;
    const timer = window.setInterval(async () => {
      try {
        const status = await api.scanStatus();
        setScan(status);
        if (!status.running) {
          window.clearInterval(timer);
          void reload();
        }
      } catch {
        window.clearInterval(timer);
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [scan?.running, reload]);

  const startScan = useCallback(async (full: boolean) => {
    try {
      const result = await api.scan(full);
      setScan(result.status);
    } catch (failure) {
      window.alert(failure instanceof Error ? failure.message : 'Impossible de lancer le scan');
    }
  }, []);

  const changeTab = useCallback((next: Tab) => {
    setTab(next);
    setGenre(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const openItem = useCallback((item: MediaItem) => setSelectedId(item.id), []);
  const closeItem = useCallback(() => setSelectedId(null), []);

  const play = useCallback((item: MediaItem, fileId?: string) => {
    const target = fileId ?? resumeFileId(item, getProgressMap());
    if (!target) return;
    setSelectedId(null);
    setPlaying({ itemId: item.id, fileId: target });
  }, []);

  const playDefault = useCallback((item: MediaItem) => play(item), [play]);
  const toggleFav = useCallback((id: string) => toggleFavorite(id), []);

  const explore = useCallback((filter: RowFilter) => {
    if (filter.genre) setGenre(filter.genre);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const filterGenre = useCallback((value: string) => {
    setSelectedId(null);
    setQuery('');
    setGenre(value);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    onLogout();
  }, [onLogout]);

  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
  const playingItem = playing ? (byId.get(playing.itemId) ?? null) : null;

  const gridTitle = searching ? `Résultats pour « ${deferredQuery.trim()} »` : (genre ?? TAB_TITLES[tab]);

  const renderContent = () => {
    if (loading && !data) return <BrowseSkeleton />;
    if (error && !data) {
      return (
        <div className="grid min-h-screen place-items-center px-6 text-center">
          <div>
            <p className="text-lg text-white">{error}</p>
            <button
              type="button"
              onClick={() => void reload()}
              className="mt-6 inline-flex items-center gap-2 rounded bg-white px-5 py-2 font-semibold text-black hover:bg-white/80"
            >
              <RefreshCw className="h-4 w-4" /> Réessayer
            </button>
          </div>
        </div>
      );
    }
    if (items.length === 0) {
      return (
        <div className="grid min-h-screen place-items-center px-6 text-center">
          <div className="max-w-lg">
            <Logo size="lg" />
            <FolderSearch className="mx-auto mt-10 h-14 w-14 text-neutral-500" />
            <h1 className="mt-4 text-2xl font-semibold text-white">Aucun titre dans la bibliothèque</h1>
            <p className="mt-3 text-neutral-400">
              Vérifiez que le disque de la Freebox est monté et que <code className="rounded bg-white/10 px-1">MEDIA_PATH</code> pointe vers le
              dossier contenant <em>Films</em> et <em>Séries</em>, puis lancez un scan.
            </p>
            {scan?.lastError && <p className="mt-4 rounded bg-[#e87c03]/15 px-3 py-2 text-sm text-[#ffb45a]">{scan.lastError}</p>}
            {!__VITRINE__ && (
            <button
              type="button"
              disabled={scan?.running}
              onClick={() => void startScan(false)}
              className="mt-8 inline-flex items-center gap-2 rounded bg-ap-red px-6 py-3 font-semibold text-white hover:bg-[#f6121d] disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${scan?.running ? 'animate-spin' : ''}`} />
              {scan?.running ? 'Scan en cours…' : 'Scanner la bibliothèque'}
            </button>
            )}
          </div>
        </div>
      );
    }

    return (
      <main className="relative">
        {showHero ? (
          <Hero
            items={featured}
            onPlay={playDefault}
            onInfo={openItem}
          />
        ) : (
          <div className="h-24 md:h-28" />
        )}

        <div className={showHero ? 'relative z-10 -mt-16 md:-mt-[7vw]' : 'relative z-10'}>
          {showGrid ? (
            <Grid
              title={gridTitle}
              items={searching ? sortSearchResults(filtered, deferredQuery) : filtered}
              progress={progress}
              favorites={favorites}
              emptyLabel={
                tab === 'mylist' && !searching
                  ? 'Ajoutez des films et séries à Ma liste avec le bouton +.'
                  : 'Aucun titre ne correspond. Essayez un autre titre, acteur ou genre.'
              }
              onOpen={openItem}
              onPlay={playDefault}
              onToggleFavorite={toggleFav}
            />
          ) : rows.length > 0 ? (
            rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                progress={progress}
                favorites={favorites}
                onOpen={openItem}
                onPlay={playDefault}
                onToggleFavorite={toggleFav}
                onExplore={explore}
              />
            ))
          ) : (
            <p className="py-20 text-center text-neutral-400">Aucun titre pour ces filtres.</p>
          )}
        </div>
      </main>
    );
  };

  return (
    <div className="min-h-screen overflow-x-clip bg-ap-bg pb-24">
      <Navbar
        categories={facets.genres}
        category={genre}
        onCategory={(value) => {
          setQuery('');
          setGenre(value);
        }}
        tab={tab}
        onTab={changeTab}
        query={query}
        onQuery={setQuery}
        scan={scan}
        onScan={(full) => void startScan(full)}
        onLogout={() => void logout()}
      />

      {renderContent()}

      <footer className="mt-16 px-4 text-xs text-neutral-600 md:px-12">
        <p>Alex Prime · Bibliothèque personnelle Freebox</p>
      </footer>

      <AnimatePresence>
        {selected && (
          <DetailModal
            key="detail"
            item={selected}
            all={items}
            progress={progress}
            isFavorite={favorites.includes(selected.id)}
            tmdbEnabled={data?.tmdbEnabled ?? false}
            onClose={closeItem}
            onPlay={play}
            onToggleFavorite={toggleFav}
            onSelect={openItem}
            onFilterGenre={filterGenre}
            onRematched={() => {
              setSelectedId(null);
              void reload();
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {playing && playingItem && (
          <Player
            key={playing.itemId}
            item={playingItem}
            fileId={playing.fileId}
            onClose={() => setPlaying(null)}
            onChangeFile={(fileId) => setPlaying({ itemId: playingItem.id, fileId })}
          />
        )}
      </AnimatePresence>

      <ScanToast scan={scan} />
    </div>
  );
}
