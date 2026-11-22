import { memo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { motion } from 'framer-motion';
import { Check, Play, Plus, Star, X } from 'lucide-react';
import type { MediaItem } from '../types';
import { imageUrl } from '../lib/api';
import { hideAmbient, showAmbient } from '../lib/ambient';
import { formatRating, isRecent, isUhd, itemMeta } from '../lib/format';

interface Props {
  item: MediaItem;
  progress?: number;
  isFavorite: boolean;
  onOpen: (item: MediaItem) => void;
  onPlay: (item: MediaItem) => void;
  onToggleFavorite: (id: string) => void;
  /** Présent dans la rangée « Reprendre la lecture » : bouton ✕ pour retirer le titre. */
  onRemove?: (id: string) => void;
  /**
   * Carte de rangée extensible (ordinateur) : remplit son emplacement, sans effet 3D ;
   * les infos n'apparaissent que lorsqu'elle est élargie (`wide`) au format paysage.
   */
  expandable?: boolean;
  wide?: boolean;
}

export const MediaCard = memo(function MediaCard({
  item,
  progress = 0,
  isFavorite,
  onOpen,
  onPlay,
  onToggleFavorite,
  onRemove,
  expandable = false,
  wide = false
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [broken, setBroken] = useState(false);
  const poster = imageUrl(item.poster);
  const backdrop = imageUrl(item.backdrop);
  const meta = itemMeta(item);

  const onMove = (event: MouseEvent<HTMLDivElement>): void => {
    if (expandable) return;
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    element.style.setProperty('--rx', `${((0.5 - y) * 14).toFixed(2)}deg`);
    element.style.setProperty('--ry', `${((x - 0.5) * 16).toFixed(2)}deg`);
    element.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
    element.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
  };

  const onEnter = (): void => {
    if (!expandable) ref.current?.style.setProperty('--s', '1.1');
    if (poster && !broken) showAmbient(poster);
  };

  const onLeave = (): void => {
    hideAmbient();
    const element = ref.current;
    if (!element) return;
    element.style.setProperty('--rx', '0deg');
    element.style.setProperty('--ry', '0deg');
    element.style.setProperty('--s', '1');
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(item);
    }
  };

  const stop = (handler: () => void) => (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    handler();
  };

  /** Classes « visible au survol » (grille) ou « visible si élargie » (rangée). */
  const reveal = expandable
    ? wide
      ? 'opacity-100 translate-y-0 delay-200'
      : 'pointer-events-none opacity-0 translate-y-3'
    : 'opacity-0 translate-y-3 group-hover/card:translate-y-0 group-hover/card:opacity-100 group-focus-within/card:translate-y-0 group-focus-within/card:opacity-100';

  return (
    <div className={`group/card relative ${expandable ? 'h-full' : ''}`}>
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        aria-label={item.title}
        onClick={() => onOpen(item)}
        onKeyDown={onKey}
        onMouseMove={onMove}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onFocus={onEnter}
        onBlur={onLeave}
        className={`relative cursor-pointer overflow-hidden rounded-md bg-neutral-800 shadow-lg ring-1 ring-white/5 outline-hidden transition-shadow duration-500 focus-visible:ring-2 focus-visible:ring-white ${
          expandable
            ? `h-full w-full ${wide ? 'shadow-[0_24px_60px_rgba(0,0,0,0.85)] ring-white/25' : ''}`
            : 'tilt-card aspect-[2/3] group-hover/card:shadow-[0_24px_60px_rgba(0,0,0,0.85)] group-hover/card:ring-white/25'
        }`}
      >
        {poster && !broken ? (
          <img
            src={poster}
            alt={item.title}
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setBroken(true)}
            className={`h-full w-full object-cover transition duration-500 ${
              expandable ? '' : 'group-hover/card:brightness-[0.55] group-focus-within/card:brightness-[0.55]'
            }`}
          />
        ) : (
          <div className="flex h-full w-full flex-col justify-end bg-linear-to-br from-[#3a0a0e] via-neutral-900 to-black p-3">
            <span className="font-display text-3xl leading-none text-ap-red">A</span>
            <span className="mt-2 line-clamp-4 font-display text-2xl leading-tight text-white">{item.title}</span>
            {item.year && <span className="text-xs text-neutral-400">{item.year}</span>}
          </div>
        )}

        {/* Format paysage : visuel large du film en fondu par-dessus l'affiche. */}
        {wide && (backdrop || poster) && (
          <motion.img
            src={backdrop ?? poster ?? undefined}
            alt=""
            draggable={false}
            initial={{ opacity: 0, scale: 1.06 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className={`absolute inset-0 h-full w-full object-cover ${backdrop ? '' : 'object-[50%_20%]'}`}
          />
        )}

        {!expandable && (
          <div className="tilt-glare pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/card:opacity-100" />
        )}

        {isRecent(item.addedAt) && (
          <span className="absolute left-0 top-2 z-10 rounded-r bg-ap-red px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow">
            Nouveau
          </span>
        )}

        {item.rating > 0 && (
          <span className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-amber-400 backdrop-blur-xs ring-1 ring-white/15 shadow">
            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
            {formatRating(item.rating)}
          </span>
        )}

        <div
          className={`absolute inset-0 flex flex-col justify-end bg-linear-to-t transition duration-300 ${
            wide ? 'from-black via-black/60 to-transparent p-4' : 'from-black/90 via-black/40 to-black/10 p-2.5'
          } ${reveal}`}
        >
          {wide && <p className="mb-2 line-clamp-2 font-display text-2xl leading-none text-white drop-shadow-lg xl:text-3xl">{item.title}</p>}
          <div className="mb-2 flex items-center gap-1.5">
            <button
              type="button"
              aria-label={`Lire ${item.title}`}
              onClick={stop(() => onPlay(item))}
              className="grid h-8 w-8 place-items-center rounded-full bg-white text-black transition hover:bg-neutral-300"
            >
              <Play className="h-4 w-4 fill-current" />
            </button>
            <button
              type="button"
              aria-label={isFavorite ? 'Retirer de Ma liste' : 'Ajouter à Ma liste'}
              onClick={stop(() => onToggleFavorite(item.id))}
              className="grid h-8 w-8 place-items-center rounded-full border-2 border-white/60 bg-black/40 text-white transition hover:border-white"
            >
              {isFavorite ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            </button>
            {onRemove && (
              <button
                type="button"
                aria-label="Retirer de Reprendre la lecture"
                title="Retirer de Reprendre la lecture"
                onClick={stop(() => onRemove(item.id))}
                className="ml-auto grid h-8 w-8 place-items-center rounded-full border-2 border-white/60 bg-black/40 text-white transition hover:border-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {!wide && <p className="line-clamp-1 text-sm font-semibold text-white">{item.title}</p>}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-neutral-300">
            {item.rating > 0 && (
              <span className="inline-flex items-center gap-1 font-semibold text-amber-400">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                {formatRating(item.rating)}
              </span>
            )}
            {item.year && <span>{item.year}</span>}
            {meta && <span>{meta}</span>}
            {isUhd(item) && (
              <span className="rounded-sm border border-white/50 px-1 text-[9px] font-bold leading-[14px] tracking-wide text-white">4K</span>
            )}
          </div>
          {item.genres.length > 0 && <p className="mt-0.5 line-clamp-1 text-[11px] text-neutral-400">{item.genres.slice(0, 3).join(' • ')}</p>}
          {item.overview && (
            <p
              className={`mt-1.5 text-[11px] leading-snug text-neutral-200 ${
                wide ? 'line-clamp-3 xl:line-clamp-4 xl:text-xs' : 'line-clamp-4 sm:line-clamp-6 xl:line-clamp-8'
              }`}
            >
              {item.overview}
            </p>
          )}
        </div>

        {progress > 0 && !wide && (
          <div className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded bg-white/25 transition-opacity group-hover/card:opacity-0">
            <div className="h-full rounded bg-ap-red" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
    </div>
  );
});
