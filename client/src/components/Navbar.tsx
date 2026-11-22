import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, LoaderCircle, LogOut, Pencil, RefreshCw, Search, Settings, Sparkles } from 'lucide-react';
import type { Profile, ScanStatus, Tab } from '../types';
import { ProfileAvatar } from './ProfileAvatar';
import { useClickOutside } from '../hooks/useClickOutside';
import { FilterBar, type CategorySection } from './FilterBar';
import { MobileNav } from './MobileNav';
import { Logo } from './Logo';

interface Props {
  profile: Profile;
  profiles: Profile[];
  onSwitchProfile: (profileId: string) => void;
  onManageProfiles: () => void;
  onOpenSettings: () => void;
  /** Nombre de titres dans Ma liste, affiché « Ma liste (3) ». */
  myListCount: number;
  categorySections: CategorySection[];
  category: string | null;
  onCategory: (tab: Tab, category: string) => void;
  tab: Tab;
  onTab: (tab: Tab) => void;
  onOpenSearch: () => void;
  /** Recherche en cours : la barre est affichée au centre de la page, pas dans le menu. */
  searchHidden: boolean;
  scan: ScanStatus | null;
  onScan: (full: boolean) => void;
  onLogout: () => void;
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'movies', label: 'Films' },
  { id: 'tv', label: 'Séries' },
  { id: 'mylist', label: 'Ma liste' }
];

export function Navbar({ profile, profiles, onSwitchProfile, onManageProfiles, onOpenSettings, myListCount, categorySections, category, onCategory, tab, onTab, onOpenSearch, searchHidden, scan, onScan, onLogout }: Props) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useClickOutside(menuRef, menuOpen, closeMenu);

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (event.key === '/' && target?.tagName !== 'INPUT' && target?.tagName !== 'TEXTAREA') {
        event.preventDefault();
        onOpenSearch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-[background-color,box-shadow,backdrop-filter] duration-500 ${
        scrolled
          ? 'border-b border-white/5 bg-[#0b0b0b]/90 shadow-[0_8px_30px_rgba(0,0,0,0.55)] backdrop-blur-xl'
          : 'bg-linear-to-b from-black/85 via-black/40 to-transparent'
      }`}
    >
      <nav className="flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center gap-3 px-4 pt-[env(safe-area-inset-top)] md:h-[68px] md:px-12 md:pt-0">
        <button type="button" onClick={() => onTab('movies')} className="shrink-0" aria-label="Films AlexFlix">
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
                {item.id === 'mylist' && myListCount > 0 ? `${item.label} (${myListCount})` : item.label}
              </button>
              {item.id === 'tv' && (
                <FilterBar sections={categorySections} value={category} activeTab={tab} onChange={onCategory} />
              )}
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-3 md:gap-5">
          {!searchHidden && (
            <motion.button
              layoutId="ap-search"
              type="button"
              aria-label="Rechercher"
              title="Rechercher (/)"
              onClick={onOpenSearch}
              transition={{ type: 'spring', stiffness: 380, damping: 34 }}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full ring-1 ring-transparent transition-colors hover:bg-white/10 hover:ring-white/15"
            >
              <Search className="h-[18px] w-[18px]" />
            </motion.button>
          )}

          {scan?.running && <LoaderCircle className="h-5 w-5 animate-spin text-ap-red" aria-label="Scan en cours" />}

          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="flex items-center gap-1.5"
              aria-label="Menu du profil"
            >
              <ProfileAvatar avatar={profile.avatar} className="h-8 w-8 rounded shadow-lg" />
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
                  {profiles
                    .filter((item) => item.id !== profile.id)
                    .map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onSwitchProfile(item.id);
                        }}
                        className="flex w-full items-center gap-3 rounded px-3 py-2 text-left hover:bg-white/10"
                      >
                        <ProfileAvatar avatar={item.avatar} className="h-7 w-7 rounded" />
                        <span className="truncate">{item.name}</span>
                      </button>
                    ))}
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onManageProfiles();
                    }}
                    className="flex w-full items-center gap-3 rounded px-3 py-2 text-left hover:bg-white/10"
                  >
                    <Pencil className="h-4 w-4" /> Gérer les profils
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenSettings();
                    }}
                    className="flex w-full items-center gap-3 rounded px-3 py-2 text-left hover:bg-white/10"
                  >
                    <Settings className="h-4 w-4" /> Paramètres
                  </button>
                  <div className="my-1 h-px bg-white/10" />
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
                      onLogout();
                    }}
                    className="flex w-full items-center gap-3 rounded px-3 py-2 text-left hover:bg-white/10"
                  >
                    <LogOut className="h-4 w-4" /> Se déconnecter
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </nav>
    </header>
    <MobileNav tab={tab} onTab={onTab} sections={categorySections} category={category} onCategory={onCategory} myListCount={myListCount} />
    </>
  );
}
