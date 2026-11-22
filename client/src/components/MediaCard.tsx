import { memo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Check, Play, Plus } from 'lucide-react';
import type { MediaItem } from '../types';
import { imageUrl } from '../lib/api';
import { isRecent, itemMeta, matchPercent } from '../lib/format';

interface Props {
  item: MediaItem;
  progress?: number;
  isFavorite: boolean;
  onOpen: (item: MediaItem) => void;
  onPlay: (item: MediaItem) => void;
  onToggleFavorite: (id: string) => void;
}

export const MediaCard = memo(function MediaCard({ item, progress = 0, isFavorite, onOpen, onPlay, onToggleFavorite }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [broken, setBroken] = useState(false);
  const poster = imageUrl(item.poster);
  const meta = itemMeta(item);

  const onMove = (event: MouseEvent<HTMLDivElement>): void => {
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
    ref.current?.style.setProperty('--s', '1.1');
  };

  const onLeave = (): void => {
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

  return (
    <div className="group/card relative">
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
        className="tilt-card relative aspect-[2/3] cursor-pointer overflow-hidden rounded-md bg-neutral-800 shadow-lg ring-1 ring-white/5 outline-hidden group-hover/card:shadow-[0_24px_60px_rgba(0,0,0,0.85)] group-hover/card:ring-white/25 focus-visible:ring-2 focus-visible:ring-white"
      >
        {poster && !broken ? (
          <img
            src={poster}
            alt={item.title}
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setBroken(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col justify-end bg-linear-to-br from-[#3a0a0e] via-neutral-900 to-black p-3">
            <span className="font-display text-3xl leading-none text-ap-red">A</span>
            <span className="mt-2 line-clamp-4 font-display text-2xl leading-tight text-white">{item.title}</span>
            {item.year && <span className="text-xs text-neutral-400">{item.year}</span>}
          </div>
        )}

        <div className="tilt-glare pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover/card:opacity-100" />

        {isRecent(item.addedAt) && (
          <span className="absolute left-0 top-2 rounded-r bg-ap-red px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow">
            Nouveau
          </span>
        )}

        <div className="absolute inset-x-0 bottom-0 translate-y-3 bg-linear-to-t from-black via-black/85 to-transparent p-2.5 pt-12 opacity-0 transition duration-300 group-hover/card:translate-y-0 group-hover/card:opacity-100 group-focus-within/card:translate-y-0 group-focus-within/card:opacity-100">
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
          </div>
          <p className="line-clamp-1 text-sm font-semibold text-white">{item.title}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-neutral-300">
            {item.rating > 0 && <span className="font-semibold text-emerald-400">{matchPercent(item.rating)} %</span>}
            {item.year && <span>{item.year}</span>}
            {meta && <span>{meta}</span>}
          </div>
          {item.genres.length > 0 && <p className="mt-0.5 line-clamp-1 text-[11px] text-neutral-400">{item.genres.slice(0, 3).join(' • ')}</p>}
        </div>

        {progress > 0 && (
          <div className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded bg-white/25 transition-opacity group-hover/card:opacity-0">
            <div className="h-full rounded bg-ap-red" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
    </div>
  );
});
