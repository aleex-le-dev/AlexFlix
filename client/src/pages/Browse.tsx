import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { FolderSearch, RefreshCw } from 'lucide-react';
import type { MediaItem, Profile, RowFilter, ScanStatus, Tab } from '../types';
import { api } from '../lib/api';
import { buildRows, facetsOf, filterItems, pickFeatured, rankByRating, resumeFileId, sortSearchResults, TOP_CATEGORY } from '../lib/catalog';
import { getProgressMap, removeFromContinue, toggleFavorite } from '../lib/storage';
import { useCatalog } from '../hooks/useCatalog';
import { useFavorites, useProgress } from '../hooks/useStorage';
import { Navbar } from '../components/Navbar';
import { AmbientBackdrop } from '../components/AmbientBackdrop';
import { Hero } from '../components/Hero';
import { Row } from '../components/Row';
import { Grid } from '../components/Grid';
import { SearchBar } from '../components/SearchBar';
import { SettingsPanel } from '../components/SettingsPanel';
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

/** « Accueil » faisait doublon avec « Films » : Films est l'onglet par défaut (?onglet=home → Films). */
const TABS: Tab[] = ['movies', 'tv', 'mylist'];

/** État de navigation conservé dans l'adresse (?onglet=&categorie=&q=&titre=) pour survivre à une actualisation. */
function readUrlState(): { tab: Tab; query: string; genre: string | null; selected: string | null } {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('onglet') as Tab | null;
  return {
    tab: tab && TABS.includes(tab) ? tab : 'movies',
    query: params.get('q') ?? '',
    genre: params.get('categorie'),
    selected: params.get('titre')
  };
}

interface BrowseProps {
  profile: Profile;
  profiles: Profile[];
  onSwitchProfile: (profileId: string) => void;
  onManageProfiles: () => void;
  onLogout: () => void;
}

export function Browse({ profile, profiles, onSwitchProfile, onManageProfiles, onLogout }: BrowseProps) {
  const [initial] = useState(readUrlState);
  const { data, loading, error, reload } = useCatalog();
  const favorites = useFavorites();
  const progress = useProgress();
  const [tab, setTab] = useState<Tab>(initial.tab);
  const [query, setQuery] = useState(initial.query);
  /** Mode recherche : barre centrée au-dessus des résultats (activé au 1er caractère tapé dans le menu). */
  const [searchMode, setSearchMode] = useState(initial.query.length > 0);
  const deferredQuery = useDeferredValue(query);
  const [genre, setGenre] = useState<string | null>(initial.genre);
  const [selectedId, setSelectedId] = useState<string | null>(initial.selected);
  const [playing, setPlaying] = useState<{ itemId: string; fileId: string } | null>(null);
  const [scan, setScan] = useState<ScanStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (tab !== 'movies') params.set('onglet', tab);
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
  /** Menu Catégories : une section Films, une section Séries (dossiers du disque uniquement). */
  const categorySections = useMemo(
    () =>
      (['movies', 'tv'] as const).map((sectionTab) => ({
        tab: sectionTab,
        label: sectionTab === 'movies' ? 'Films' : 'Séries',
        categories: facetsOf(filterItems(items, { tab: sectionTab, genre: null, theme: null, query: '', favorites })).genres
      })),
    [items, favorites]
  );
  const filtered = useMemo(
    // La recherche porte sur tout le catalogue (films + séries), quel que soit l'onglet.
    () => filterItems(deferredQuery.trim() ? items : tabItems, { tab: 'home', genre, theme: null, query: deferredQuery, favorites }),
    [items, tabItems, genre, deferredQuery, favorites]
  );
  const featured = useMemo(() => pickFeatured(filtered), [filtered]);
  const rows = useMemo(
    () => buildRows(filtered, { progress, favorites, activeGenre: genre, activeTheme: null }),
    [filtered, progress, favorites, genre]
  );

  const searching = deferredQuery.trim().length > 0;
  const showGrid = searchMode || searching || tab === 'mylist' || genre === TOP_CATEGORY;
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
    setQuery('');
    setSearchMode(false);
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
  const removeContinue = useCallback((id: string) => removeFromContinue(id), []);

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
      <main className="relative z-[1]">
        {showHero ? (
          <Hero
            items={featured}
            onPlay={playDefault}
            onInfo={openItem}
          />
        ) : (
          <div className={searchMode ? 'h-20 md:h-[88px]' : 'h-24 md:h-28'} />
        )}

        <div className={showHero ? 'relative z-10 -mt-16 md:-mt-[7vw]' : 'relative z-10'}>
          {searchMode && (
            <SearchBar
              value={query}
              count={searching ? filtered.length : 0}
              onChange={setQuery}
              onClose={() => {
                setQuery('');
                setSearchMode(false);
              }}
            />
          )}
          {showGrid ? (
            <Grid
              title={searchMode ? '' : gridTitle}
              items={
                searchMode && !searching
                  ? []
                  : searching
                    ? sortSearchResults(filtered, deferredQuery)
                    : genre === TOP_CATEGORY
                      ? rankByRating(filtered)
                      : filtered
              }
              progress={progress}
              favorites={favorites}
              emptyLabel={
                searchMode && !searching
                  ? 'Tapez un titre, un acteur ou une saga.'
                  : tab === 'mylist' && !searching
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
                onRemove={row.id === 'continue' ? removeContinue : undefined}
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
      <AmbientBackdrop />
      <Navbar
        categorySections={categorySections}
        category={genre}
        onCategory={(nextTab, value) => {
          setQuery('');
          setSearchMode(false);
          setTab(nextTab);
          setGenre(value);
        }}
        tab={tab}
        onTab={changeTab}
        onOpenSearch={() => setSearchMode(true)}
        searchHidden={searchMode}
        scan={scan}
        onScan={(full) => void startScan(full)}
        profile={profile}
        profiles={profiles}
        onSwitchProfile={onSwitchProfile}
        onManageProfiles={onManageProfiles}
        onOpenSettings={() => setSettingsOpen(true)}
        onLogout={onLogout}
      />

      {renderContent()}

      <footer className="relative z-[1] mt-16 px-4 text-xs text-neutral-600 md:px-12">
        <p>AlexFlix · Bibliothèque personnelle Freebox</p>
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
            onRemoveProgress={removeContinue}
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

      <AnimatePresence>{settingsOpen && <SettingsPanel key="settings" onClose={closeSettings} />}</AnimatePresence>

      <ScanToast scan={scan} />
    </div>
  );
}
