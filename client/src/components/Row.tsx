import { memo, useId } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { FreeMode, Keyboard, Mousewheel, Navigation } from 'swiper/modules';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import 'swiper/css';
import 'swiper/css/free-mode';
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

const NAV_BUTTON =
  'absolute bottom-6 top-6 z-40 hidden w-10 items-center justify-center bg-black/55 text-white opacity-0 transition duration-300 hover:bg-black/75 group-hover/row:opacity-100 md:flex md:w-12 [&.swiper-button-disabled]:pointer-events-none [&.swiper-button-disabled]:!opacity-0';

export const Row = memo(function Row({ row, progress, favorites, onOpen, onPlay, onToggleFavorite, onExplore, onRemove }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const prevClass = `ap-prev-${uid}`;
  const nextClass = `ap-next-${uid}`;

  return (
    <section className="ap-row group/row relative my-2 hover:z-20 md:my-4">
      <h2 className="flex items-baseline gap-3 px-4 text-base font-semibold text-neutral-100 md:px-12 md:text-[1.4rem]">
        {row.title}
        {row.filter && (
          <button
            type="button"
            onClick={() => row.filter && onExplore(row.filter)}
            className="translate-x-[-6px] text-xs font-semibold text-[#54b9c5] opacity-0 transition duration-300 group-hover/row:translate-x-0 group-hover/row:opacity-100 md:text-sm"
          >
            Tout explorer ›
          </button>
        )}
      </h2>
      <div className="relative">
        <button type="button" aria-label="Précédent" className={`${prevClass} ${NAV_BUTTON} left-0 rounded-r`}>
          <ChevronLeft className="h-9 w-9" />
        </button>
        <Swiper
          modules={[Navigation, Keyboard, Mousewheel, FreeMode]}
          navigation={{ prevEl: `.${prevClass}`, nextEl: `.${nextClass}` }}
          keyboard={{ enabled: false }}
          mousewheel={{ forceToAxis: true, releaseOnEdges: true, sensitivity: 1, thresholdDelta: 2 }}
          freeMode={{ enabled: true, sticky: false, momentum: true, momentumRatio: 0.6, momentumVelocityRatio: 0.6 }}
          watchOverflow
          speed={700}
          spaceBetween={8}
          slidesPerView={2.3}
          slidesPerGroup={2}
          breakpoints={{
            640: { slidesPerView: 3.3, slidesPerGroup: 3 },
            900: { slidesPerView: 4.3, slidesPerGroup: 4 },
            1200: { slidesPerView: 5.3, slidesPerGroup: 5 },
            1600: { slidesPerView: 6.3, slidesPerGroup: 6 },
            2000: { slidesPerView: 7.3, slidesPerGroup: 7 }
          }}
          className="!px-4 !py-6 md:!px-12"
        >
          {row.items.map((item) => (
            <SwiperSlide key={item.id}>
              <MediaCard
                item={item}
                progress={progressRatio(itemProgress(item, progress))}
                isFavorite={favorites.includes(item.id)}
                onOpen={onOpen}
                onPlay={onPlay}
                onToggleFavorite={onToggleFavorite}
                onRemove={onRemove}
              />
            </SwiperSlide>
          ))}
        </Swiper>
        <button type="button" aria-label="Suivant" className={`${nextClass} ${NAV_BUTTON} right-0 rounded-l`}>
          <ChevronRight className="h-9 w-9" />
        </button>
      </div>
    </section>
  );
});
