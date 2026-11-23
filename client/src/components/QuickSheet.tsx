import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Check, Info, Play, Plus, Star, X } from 'lucide-react';
import type { MediaItem } from '../types';
import { artUrl } from '../lib/api';
import { formatRating, isUhd, itemMeta } from '../lib/format';
import { lockScroll } from '../lib/scrollLock';
import { SmoothImg } from './SmoothImg';

interface Props {
  item: MediaItem;
  isFavorite: boolean;
  progress: number;
  onPlay: (item: MediaItem) => void;
  onToggleFavorite: (id: string) => void;
  onMore: (item: MediaItem) => void;
  onClose: () => void;
}

/** Mobile : aperçu rapide au toucher d'une affiche (panneau du bas), avant la fiche complète. */
export function QuickSheet({ item, isFavorite, progress, onPlay, onToggleFavorite, onMore, onClose }: Props) {
  useEffect(() => lockScroll(), []);
  const art = artUrl(item.backdrop, 'md') ?? artUrl(item.poster, 'md');
  const meta = itemMeta(item);

  return (
    <>
      <motion.div
        key="quick-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[75] bg-black/60 backdrop-blur-sm"
      />
      <motion.div
        key="quick-sheet"
        role="dialog"
        aria-label={item.title}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 420, damping: 40 }}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.6 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 90 || info.velocity.y > 500) onClose();
        }}
        className="fixed inset-x-0 bottom-0 z-[76] overflow-hidden rounded-t-3xl bg-[#181818] pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[0_-20px_60px_rgba(0,0,0,0.6)] ring-1 ring-white/10"
      >
        <div className="relative aspect-video w-full bg-neutral-900">
          {art && <SmoothImg src={art} alt="" className="h-full w-full object-cover" />}
          <div className="absolute inset-0 bg-linear-to-t from-[#181818] via-transparent to-black/30" />
          <span aria-hidden="true" className="absolute left-1/2 top-2 h-1.5 w-10 -translate-x-1/2 rounded-full bg-white/60" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white"
          >
            <X className="h-4 w-4" />
          </button>
          {progress > 0.01 && progress < 0.95 && (
            <div className="absolute inset-x-4 bottom-2 h-1 overflow-hidden rounded bg-white/25">
              <div className="h-full bg-ap-red" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
        </div>

        <div className="px-5 pt-3">
          <h2 className="font-display text-3xl leading-none text-white">{item.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-neutral-300">
            {item.rating > 0 && (
              <span className="inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 font-semibold text-amber-400 ring-1 ring-white/15">
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                {formatRating(item.rating)}
              </span>
            )}
            {item.categories[0] && <span className="rounded bg-white/10 px-1.5 py-0.5 text-white">{item.categories[0]}</span>}
            {item.year && <span>{item.year}</span>}
            {meta && <span>{meta}</span>}
            {isUhd(item) && <span className="rounded-sm border border-white/60 px-1 text-[10px] font-bold leading-4 text-white">4K</span>}
          </div>
          {item.overview && <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-neutral-200">{item.overview}</p>}

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => onPlay(item)}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-white py-3 text-base font-semibold text-black active:scale-[0.98]"
            >
              <Play className="h-5 w-5 fill-current" /> {progress > 0.01 && progress < 0.95 ? 'Reprendre' : 'Lecture'}
            </button>
            <button
              type="button"
              onClick={() => onToggleFavorite(item.id)}
              aria-label={isFavorite ? 'Retirer de Ma liste' : 'Ajouter à Ma liste'}
              className="flex flex-col items-center gap-1 px-1 text-[11px] text-neutral-300"
            >
              <span className="grid h-10 w-10 place-items-center rounded-full ring-1 ring-white/30">
                {isFavorite ? <Check className="h-5 w-5 text-white" /> : <Plus className="h-5 w-5 text-white" />}
              </span>
              Ma liste
            </button>
            <button type="button" onClick={() => onMore(item)} aria-label="Plus d'infos" className="flex flex-col items-center gap-1 px-1 text-[11px] text-neutral-300">
              <span className="grid h-10 w-10 place-items-center rounded-full ring-1 ring-white/30">
                <Info className="h-5 w-5 text-white" />
              </span>
              Infos
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}
