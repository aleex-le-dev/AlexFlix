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
            <motion.ul
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="absolute left-0 top-full z-40 mt-3 grid w-max grid-cols-2 gap-x-10 border border-white/15 bg-black/95 px-4 py-3 text-sm sm:grid-cols-3"
            >
              {value && (
                <li className="col-span-full">
                  <button type="button" onClick={() => pick(null)} className="py-1 font-semibold text-white hover:underline">
                    Toutes les catégories
                  </button>
                </li>
              )}
              {categories.map((category) => (
                <li key={category.name}>
                  <button
                    type="button"
                    onClick={() => pick(category.name)}
                    className={`py-1 text-left hover:underline ${category.name === value ? 'font-semibold text-white' : 'text-neutral-300'}`}
                  >
                    {category.name}
                  </button>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
