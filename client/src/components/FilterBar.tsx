import { useCallback, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import type { Facet } from '../types';
import { useClickOutside } from '../hooks/useClickOutside';

interface Props {
  title?: string | null;
  categories: Facet[];
  value: string | null;
  onChange: (category: string | null) => void;
  /** Variante barre de navigation : même style que les onglets Films / Séries. */
  nav?: boolean;
}

/** Liste déroulante « Catégories » (dossiers du disque), façon menu Genres de Netflix. */
export function FilterBar({ title = null, categories, value, onChange, nav = false }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, open, close);

  if (categories.length < 2 && !value) return null;

  const pick = (category: string | null): void => {
    onChange(category);
    setOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="flex items-center gap-6">
      {title && <h1 className="text-2xl font-semibold text-white md:text-4xl">{title}</h1>}
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((state) => !state)}
          className={
            nav
              ? `inline-flex items-center gap-1 text-sm transition-colors hover:text-neutral-300 ${value ? 'font-semibold text-white' : 'text-neutral-300/90'}`
              : 'inline-flex items-center gap-6 border border-white bg-black px-2.5 py-1 text-sm font-semibold text-white hover:bg-white/10'
          }
        >
          {value ?? 'Catégories'}
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
              className="absolute left-0 top-full z-40 mt-4 w-[min(600px,calc(100vw-2rem))] max-md:fixed max-md:left-4 max-md:top-14 origin-top-left overflow-hidden rounded-xl bg-[#141414]/85 shadow-[0_24px_70px_rgba(0,0,0,0.8)] ring-1 ring-white/10 backdrop-blur-2xl"
            >
              <div className="h-0.5 bg-linear-to-r from-ap-red via-ap-red/60 to-transparent" />
              <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-3.5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Catégories</p>
                <button
                  type="button"
                  onClick={() => pick(null)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    value ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-white text-black'
                  }`}
                >
                  Tout afficher
                </button>
              </div>
              <ul className="grid max-h-[60vh] grid-cols-2 gap-1 overflow-y-auto p-2.5 sm:grid-cols-3">
                {categories.map((category) => {
                  const active = category.name === value;
                  return (
                    <li key={category.name}>
                      <button
                        type="button"
                        onClick={() => pick(category.name)}
                        aria-current={active ? 'true' : undefined}
                        className={`group/cat relative flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                          active ? 'bg-ap-red/15 font-semibold text-white' : 'text-neutral-300 hover:bg-white/8 hover:text-white'
                        }`}
                      >
                        {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-ap-red" />}
                        <span className="truncate">{category.name}</span>
                        <span
                          className={`shrink-0 rounded-full px-1.5 text-[11px] tabular-nums transition ${
                            active ? 'bg-ap-red text-white' : 'bg-white/5 text-neutral-500 group-hover/cat:text-neutral-300'
                          }`}
                        >
                          {category.count}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
