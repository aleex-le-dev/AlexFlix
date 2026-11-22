import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bookmark, Clapperboard, LayoutGrid, Tv } from 'lucide-react';
import type { Tab } from '../types';
import type { CategorySection } from './FilterBar';
import { lockScroll } from '../lib/scrollLock';

interface Props {
  tab: Tab;
  onTab: (tab: Tab) => void;
  sections: CategorySection[];
  category: string | null;
  onCategory: (tab: Tab, category: string) => void;
}

type Item = { id: Tab | 'categories'; label: string; icon: typeof Clapperboard };

const ITEMS: Item[] = [
  { id: 'movies', label: 'Films', icon: Clapperboard },
  { id: 'tv', label: 'Séries', icon: Tv },
  { id: 'categories', label: 'Catégories', icon: LayoutGrid },
  { id: 'mylist', label: 'Ma liste', icon: Bookmark }
];

/** Mobile : barre d'onglets en bas (au pouce) + panneau Catégories qui monte du bas. */
export function MobileNav({ tab, onTab, sections, category, onCategory }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const visible = sections.filter((section) => section.categories.length > 0);

  useEffect(() => {
    if (!sheetOpen) return undefined;
    return lockScroll();
  }, [sheetOpen]);

  const activeId: Item['id'] = sheetOpen || category ? 'categories' : tab;

  return (
    <>
      <nav
        aria-label="Navigation"
        className="fixed inset-x-0 bottom-0 z-[60] border-t border-white/10 bg-[#0b0b0b]/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      >
        <ul className="grid grid-cols-4">
          {ITEMS.map((item) => {
            const active = activeId === item.id;
            const Icon = item.icon;
            const label = item.id === 'categories' && category ? category : item.label;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (item.id === 'categories') setSheetOpen((open) => !open);
                    else {
                      setSheetOpen(false);
                      onTab(item.id);
                    }
                  }}
                  className="relative flex h-16 w-full flex-col items-center justify-center gap-1 active:scale-95"
                >
                  {active && (
                    <motion.span
                      layoutId="ap-mobile-tab"
                      className="absolute top-0 h-[3px] w-10 rounded-b-full bg-ap-red"
                      transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                    />
                  )}
                  <Icon className={`h-[22px] w-[22px] transition-colors ${active ? 'text-white' : 'text-neutral-500'}`} strokeWidth={active ? 2.4 : 2} />
                  <span className={`max-w-[88%] truncate text-[11px] transition-colors ${active ? 'font-semibold text-white' : 'text-neutral-500'}`}>
                    {label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <AnimatePresence>
        {sheetOpen && (
          <>
            <motion.div
              key="sheet-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSheetOpen(false)}
              className="fixed inset-0 z-[55] bg-black/60 backdrop-blur-sm md:hidden"
            />
            <motion.div
              key="sheet"
              role="dialog"
              aria-label="Catégories"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 420, damping: 40 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 90 || info.velocity.y > 500) setSheetOpen(false);
              }}
              className="fixed inset-x-0 bottom-0 z-[58] max-h-[78vh] overflow-y-auto rounded-t-3xl bg-[#161616] px-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-20px_60px_rgba(0,0,0,0.6)] ring-1 ring-white/10 md:hidden"
            >
              <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-white/20" />
              {visible.map((section) => (
                <section key={section.tab} className="mb-5">
                  <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">{section.label}</p>
                  <div className="flex flex-wrap gap-2">
                    {section.categories.map((item) => {
                      const active = item.name === category && section.tab === tab;
                      return (
                        <button
                          key={item.name}
                          type="button"
                          onClick={() => {
                            onCategory(section.tab, item.name);
                            setSheetOpen(false);
                          }}
                          className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm transition active:scale-95 ${
                            active ? 'bg-ap-red font-semibold text-white' : 'bg-white/8 text-neutral-200 ring-1 ring-white/10'
                          }`}
                        >
                          {item.name}
                          <span className={`text-xs tabular-nums ${active ? 'text-white/80' : 'text-neutral-500'}`}>{item.count}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
