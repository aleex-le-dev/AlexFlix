import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, LoaderCircle, LogOut, RefreshCw, Search, Sparkles, Users, X } from 'lucide-react';
import type { Facet, ScanStatus, Tab } from '../types';
import { useClickOutside } from '../hooks/useClickOutside';
import { FilterBar } from './FilterBar';
import { Logo } from './Logo';

interface Props {
  categories: Facet[];
  category: string | null;
  onCategory: (category: string | null) => void;
  tab: Tab;
  onTab: (tab: Tab) => void;
  query: string;
  onQuery: (query: string) => void;
  scan: ScanStatus | null;
  onScan: (full: boolean) => void;
  onLogout: () => void;
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'home', label: 'Accueil' },
  { id: 'movies', label: 'Films' },
  { id: 'tv', label: 'Séries' },
  { id: 'mylist', label: 'Ma liste' }
];

export function Navbar({ categories, category, onCategory, tab, onTab, query, onQuery, scan, onScan, onLogout }: Props) {
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(query.length > 0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const browseRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closeBrowse = useCallback(() => setBrowseOpen(false), []);
  useClickOutside(menuRef, menuOpen, closeMenu);
  useClickOutside(browseRef, browseOpen, closeBrowse);

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (event.key === '/' && target?.tagName !== 'INPUT' && target?.tagName !== 'TEXTAREA') {
        event.preventDefault();
        setSearchOpen(true);
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const current = TABS.find((item) => item.id === tab) ?? TABS[0];

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-[background-color,box-shadow,backdrop-filter] duration-500 ${
        scrolled
          ? 'border-b border-white/5 bg-[#0b0b0b]/90 shadow-[0_8px_30px_rgba(0,0,0,0.55)] backdrop-blur-xl'
          : 'bg-linear-to-b from-black/85 via-black/40 to-transparent'
      }`}
    >
      <nav className="flex h-16 items-center gap-3 px-4 md:h-[68px] md:px-12">
        <button type="button" onClick={() => onTab('home')} className="shrink-0" aria-label="Accueil Alex Prime">
          <Logo size="sm" />
        </button>

        <ul className="ml-8 hidden items-center gap-5 text-sm md:flex">
          {TABS.map((item) => (
            <li key={item.id} className="flex items-center gap-5">
              <button
                type="button"
                onClick={() => onTab(item.id)}
                className={`transition-colors hover:text-neutral-300 ${tab === item.id ? 'font-semibold text-white' : 'text-neutral-300/90'}`}
              >
                {item.label}
              </button>
              {item.id === 'tv' && tab !== 'mylist' && (
                <FilterBar nav categories={categories} value={category} onChange={onCategory} />
              )}
            </li>
          ))}
        </ul>

        {tab !== 'mylist' && (
          <div className="ml-3 md:hidden">
            <FilterBar nav categories={categories} value={category} onChange={onCategory} />
          </div>
        )}

        <div ref={browseRef} className="relative ml-2 md:hidden">
          <button type="button" onClick={() => setBrowseOpen((open) => !open)} className="flex items-center gap-1 text-sm font-semibold">
            {current.label}
            <ChevronDown className={`h-4 w-4 transition-transform ${browseOpen ? 'rotate-180' : ''}`} />
          </button>
          <AnimatePresence>
            {browseOpen && (
              <motion.ul
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="absolute left-1/2 top-full mt-4 w-48 -translate-x-1/2 overflow-hidden rounded-md border border-white/10 bg-black/90 py-2 text-center backdrop-blur-xl"
              >
                {TABS.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onTab(item.id);
                        setBrowseOpen(false);
                      }}
                      className={`w-full px-4 py-2.5 text-sm hover:bg-white/10 ${tab === item.id ? 'font-semibold text-white' : 'text-neutral-300'}`}
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>

        <div className="ml-auto flex items-center gap-3 md:gap-5">
          <div
            className={`flex items-center border transition-all duration-300 ${
              searchOpen ? 'border-white/70 bg-black/70 backdrop-blur' : 'border-transparent'
            }`}
          >
            <button
              type="button"
              aria-label="Rechercher"
              onClick={() => {
                setSearchOpen(true);
                inputRef.current?.focus();
              }}
              className="p-1.5"
            >
              <Search className="h-5 w-5" />
            </button>
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              onBlur={() => {
                if (!query) setSearchOpen(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  onQuery('');
                  setSearchOpen(false);
                  inputRef.current?.blur();
                }
              }}
              placeholder="Titres, acteurs, genres, thèmes"
              aria-label="Recherche instantanée"
              className={`bg-transparent text-sm outline-hidden transition-all duration-300 placeholder:text-neutral-400 ${
                searchOpen ? 'w-36 pr-2 sm:w-64' : 'w-0'
              }`}
            />
            {query && (
              <button type="button" aria-label="Effacer la recherche" onClick={() => onQuery('')} className="pr-2">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {scan?.running && <LoaderCircle className="h-5 w-5 animate-spin text-ap-red" aria-label="Scan en cours" />}

          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="flex items-center gap-1.5"
              aria-label="Menu du profil"
            >
              <span className="grid h-8 w-8 place-items-center rounded bg-linear-to-br from-ap-red to-[#5c0309] font-display text-xl text-white shadow-lg">
                A
              </span>
              <ChevronDown className={`hidden h-4 w-4 transition-transform sm:block ${menuOpen ? 'rotate-180' : ''}`} />
            </button>
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.98 }}
                  transition={{ duration: 0.18 }}
                  className="absolute right-0 top-full mt-3 w-64 rounded-md border border-white/10 bg-black/90 p-2 text-sm shadow-2xl backdrop-blur-xl"
                >
                  {__VITRINE__ ? null : (
                  <>
                  <p className="px-3 pb-2 pt-1 text-xs uppercase tracking-wider text-neutral-500">Bibliothèque Freebox</p>
                  <button
                    type="button"
                    disabled={scan?.running}
                    onClick={() => {
                      onScan(false);
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded px-3 py-2 text-left hover:bg-white/10 disabled:opacity-50"
                  >
                    <RefreshCw className="h-4 w-4" /> Actualiser la bibliothèque
                  </button>
                  <button
                    type="button"
                    disabled={scan?.running}
                    onClick={() => {
                      onScan(true);
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded px-3 py-2 text-left hover:bg-white/10 disabled:opacity-50"
                  >
                    <Sparkles className="h-4 w-4" /> Scan complet (TMDB)
                  </button>
                  {scan && scan.phase !== 'idle' && (
                    <p className="px-3 py-2 text-xs text-neutral-400">
                      {scan.running
                        ? `Scan en cours… ${scan.processed}/${scan.newFiles}`
                        : `Dernier scan : ${scan.itemsTotal} titres${scan.errors.length ? ` · ${scan.errors.length} alerte(s)` : ''}`}
                    </p>
                  )}
                  </>
                  )}
                  {!__VITRINE__ && <div className="my-1 h-px bg-white/10" />}
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      window.dispatchEvent(new Event('alexprime:profiles'));
                    }}
                    className="flex w-full items-center gap-3 rounded px-3 py-2 text-left hover:bg-white/10"
                  >
                    <Users className="h-4 w-4" /> Changer de profil
                  </button>
                  <button
                    type="button"
                    onClick={onLogout}
                    className="flex w-full items-center gap-3 rounded px-3 py-2 text-left hover:bg-white/10"
                  >
                    <LogOut className="h-4 w-4" /> Se déconnecter d'Alex Prime
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </nav>
    </header>
  );
}
