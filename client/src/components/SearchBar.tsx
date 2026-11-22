import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Search, X } from 'lucide-react';

interface Props {
  value: string;
  count: number;
  onChange: (value: string) => void;
  onClose: () => void;
}

/** Grande barre de recherche centrée au-dessus des résultats ; elle « glisse » depuis la barre de menu (layoutId partagé). */
export function SearchBar({ value, count, onChange, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  return (
    <div className="flex flex-col items-center px-4 pb-2 pt-1 md:px-12">
      <motion.div
        layoutId="ap-search"
        transition={{ type: 'spring', stiffness: 380, damping: 34 }}
        className="flex h-11 w-full max-w-lg items-center gap-2.5 rounded-full bg-white/10 pl-4 pr-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.5)] ring-1 ring-white/15 backdrop-blur-xl focus-within:bg-white/15 focus-within:ring-white/35"
      >
        <Search className="h-[18px] w-[18px] shrink-0 text-neutral-300" />
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => event.key === 'Escape' && onClose()}
          placeholder="Film, série, acteur, saga…"
          aria-label="Recherche"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-hidden placeholder:text-neutral-400"
        />
        <button
          type="button"
          aria-label="Fermer la recherche"
          onClick={onClose}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/15 text-neutral-200 transition hover:bg-white/25 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </motion.div>
      {value.trim() && (
        <p className="mt-3 text-sm text-neutral-400">
          {count} résultat{count > 1 ? 's' : ''} pour « {value.trim()} »
        </p>
      )}
    </div>
  );
}
