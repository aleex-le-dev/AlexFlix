import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { MediaItem, RowDef, RowFilter } from '../types';
import { itemProgress, progressRatio } from '../lib/catalog';
import type { ProgressEntry } from '../lib/storage';
import { MediaCard } from './MediaCard';

interface Props {
  row: RowDef;
  progress: Record<string, ProgressEntry>;
  favorites: string[];
  onOpen: (item: MediaItem) => void;
  onPlay: (item: MediaItem) => void;
  onToggleFavorite: (id: string) => void;
  onExplore: (filter: RowFilter) => void;
  onRemove?: (id: string) => void;
}

/** Souris + survol réel (pas d'écran tactile) : seul cas où les cartes s'élargissent. */
const canHover = (): boolean => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

const NAV_BUTTON =
  'absolute bottom-6 top-6 z-30 hidden w-10 items-center justify-center bg-black/55 text-white opacity-0 transition duration-300 hover:bg-black/75 group-hover/row:opacity-100 md:flex md:w-12';

/**
 * Rangée façon Netflix : défilement natif (tactile, pavé, molette) et, à la souris,
 * la carte survolée s'élargit sur deux emplacements en poussant ses voisines.
 */
export const Row = memo(function Row({ row, progress, favorites, onOpen, onPlay, onToggleFavorite, onExplore, onRemove }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const enterTimer = useRef(0);
  const leaveTimer = useRef(0);
  const [hoverable] = useState(canHover);
  // Une carte est toujours élargie : la première au départ, puis la dernière survolée.
  const [wideId, setWideId] = useState<string | null>(row.items[0]?.id ?? null);
  const shownWide = wideId && row.items.some((item) => item.id === wideId) ? wideId : (row.items[0]?.id ?? null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const updateEdges = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    setEdges({ start: track.scrollLeft <= 4, end: track.scrollLeft + track.clientWidth >= track.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    updateEdges();
    window.addEventListener('resize', updateEdges);
    return () => {
      window.removeEventListener('resize', updateEdges);
      window.clearTimeout(enterTimer.current);
      window.clearTimeout(leaveTimer.current);
    };
  }, [updateEdges, row.items.length]);

  /** Après un défilement par flèche, la carte double redevient la première carte visible. */
  const widenFirstVisible = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const padding = Number.parseFloat(getComputedStyle(track).paddingLeft) || 0;
    const slots = Array.from(track.querySelectorAll<HTMLElement>('.ap-slot'));
    const first = slots.find((slot) => slot.offsetLeft - padding >= track.scrollLeft - 4) ?? slots[slots.length - 1];
    const index = first ? slots.indexOf(first) : -1;
    if (index >= 0 && row.items[index]) setWideId(row.items[index].id);
  }, [row.items]);

  const scrollBy = (direction: 1 | -1): void => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * track.clientWidth * 0.85, behavior: 'smooth' });
    window.clearTimeout(enterTimer.current);
    enterTimer.current = window.setTimeout(widenFirstVisible, 650);
  };

  /** Petit délai : passer la souris en travers de la rangée n'élargit pas chaque carte. */
  const hoverCard = (id: string): void => {
    if (!hoverable) return;
    window.clearTimeout(leaveTimer.current);
    window.clearTimeout(enterTimer.current);
    enterTimer.current = window.setTimeout(() => setWideId(id), 140);
  };

  /** En quittant la rangée, la carte élargie reste celle-ci (comme Netflix). */
  const leaveTrack = (): void => {
    window.clearTimeout(enterTimer.current);
  };

  return (
    <section className="ap-row group/row relative my-2 hover:z-20 md:my-4">
      <h2 className="flex items-baseline gap-3 px-4 text-base font-semibold text-neutral-100 md:px-12 md:text-[1.4rem]">
        {row.title}
        {row.filter && (
          <button
            type="button"
            onClick={() => row.filter && onExplore(row.filter)}
            className="text-xs font-semibold text-[#54b9c5] opacity-80 transition duration-300 hover:opacity-100 hover:underline group-hover/row:translate-x-1 group-hover/row:opacity-100 md:text-sm"
          >
            Tout explorer ›
          </button>
        )}
      </h2>
      <div className="relative">
        {!edges.start && (
          <button type="button" aria-label="Précédent" onClick={() => scrollBy(-1)} className={`${NAV_BUTTON} left-0 rounded-r`}>
            <ChevronLeft className="h-9 w-9" />
          </button>
        )}
        <div
          ref={trackRef}
          onScroll={updateEdges}
          onMouseLeave={leaveTrack}
          className="ap-track flex gap-2 overflow-x-auto overflow-y-hidden scroll-px-4 px-4 py-6 md:scroll-px-12 md:px-12"
        >
          {row.items.map((item) => {
            const wide = shownWide === item.id;
            return (
              <div
                key={item.id}
                data-wide={wide}
                onMouseEnter={() => hoverCard(item.id)}
                onFocus={() => hoverable && setWideId(item.id)}
                className="ap-slot relative"
              >
                <MediaCard
                  item={item}
                  progress={progressRatio(itemProgress(item, progress))}
                  isFavorite={favorites.includes(item.id)}
                  onOpen={onOpen}
                  onPlay={onPlay}
                  onToggleFavorite={onToggleFavorite}
                  onRemove={onRemove}
                  expandable
                  wide={wide}
                  trailerPreview={row.id.startsWith('collection-')}
                />
              </div>
            );
          })}
          {/* Marge de fin : la dernière carte peut s'élargir sans être coupée. */}
          <div aria-hidden="true" className="w-px shrink-0" />
        </div>
        {!edges.end && (
          <button type="button" aria-label="Suivant" onClick={() => scrollBy(1)} className={`${NAV_BUTTON} right-0 rounded-l`}>
            <ChevronRight className="h-9 w-9" />
          </button>
        )}
      </div>
    </section>
  );
});
