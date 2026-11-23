import { useCallback, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import type { Facet, Tab } from '../types';
import { useClickOutside } from '../hooks/useClickOutside';

export interface CategorySection {
  tab: Tab;
  label: string;
  categories: Facet[];
}

interface Props {
  sections: CategorySection[];
  value: string | null;
  activeTab: Tab;
  onChange: (tab: Tab, category: string) => void;
}

/** Menu « Catégories » (dossiers du disque) : une section Films, une section Séries. */
export function FilterBar({ sections, value, activeTab, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, open, close);

  // Le bouton reste affiché pendant le chargement du catalogue ; le menu s'ouvre une fois les catégories connues.
  const visible = sections.filter((section) => section.categories.length > 0);

  const pick = (tab: Tab, category: string): void => {
    onChange(tab, category);
    setOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((state) => !state)}
        className={`inline-flex items-center gap-1 text-sm transition-colors hover:text-neutral-300 ${value ? 'font-semibold text-white' : 'text-neutral-300/90'}`}
      >
        Catégories
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && visible.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
            className="absolute left-0 top-full z-40 mt-4 max-h-[75vh] w-[min(600px,calc(100vw-2rem))] origin-top-left overflow-y-auto rounded-xl bg-[#141414]/85 p-2.5 shadow-[0_24px_70px_rgba(0,0,0,0.8)] ring-1 ring-white/10 backdrop-blur-2xl max-md:fixed max-md:left-4 max-md:top-14"
          >
            {visible.map((section, index) => (
              <section key={section.tab} className={index > 0 ? 'mt-2 border-t border-white/10 pt-2' : ''}>
                <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">{section.label}</p>
                <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                  {section.categories.map((category) => {
                    const active = category.name === value && section.tab === activeTab;
                    return (
                      <li key={category.name}>
                        <button
                          type="button"
                          onClick={() => pick(section.tab, category.name)}
                          aria-current={active ? 'true' : undefined}
                          className={`group/cat relative flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                            active ? 'bg-ap-red/15 font-semibold text-white' : 'text-neutral-300 hover:bg-white/8 hover:text-white'
                          }`}
                        >
                          {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-ap-red" />}
                          <span className="truncate">{category.name}</span>
                          <span
                            className={`shrink-0 rounded-full px-1.5 text-[11px] tabular-nums transition ${
                              active ? 'bg-ap-red text-white' : 'bg-white/5 text-neutral-400 group-hover/cat:text-neutral-300'
                            }`}
                          >
                            {category.count}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
