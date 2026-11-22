import { Swiper, SwiperSlide } from 'swiper/react';
import { Autoplay, Keyboard, Mousewheel } from 'swiper/modules';
import { Info, Play } from 'lucide-react';
import 'swiper/css';
import type { MediaItem } from '../types';
import { imageUrl } from '../lib/api';

interface Props {
  items: MediaItem[];
  onPlay: (item: MediaItem) => void;
  onInfo: (item: MediaItem) => void;
}

function HeroSlide({ item, active, onPlay, onInfo }: { item: MediaItem; active: boolean; onPlay: Props['onPlay']; onInfo: Props['onInfo'] }) {
  const art = imageUrl(item.backdrop) ?? imageUrl(item.poster);
  return (
    <div className="relative h-full w-full overflow-hidden">
      {art ? (
        <img
          src={art}
          alt=""
          draggable={false}
          className={`h-full w-full object-cover object-top ${active ? 'animate-kenburns' : ''}`}
        />
      ) : (
        <div className="h-full w-full bg-linear-to-br from-[#2a0306] via-[#141414] to-black" />
      )}

      <div className="pointer-events-none absolute inset-0 bg-linear-to-r from-black/85 via-black/35 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-ap-bg via-ap-bg/60 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-linear-to-b from-black/60 to-transparent" />

      <div
        className={`absolute inset-x-4 bottom-[18%] top-24 flex max-w-xl flex-col justify-end transition-all duration-700 md:inset-x-12 md:bottom-[24%] md:top-32 lg:max-w-2xl ${
          active ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
        }`}
      >
        <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-neutral-200">
          <span className="font-display text-2xl leading-none tracking-normal text-ap-red">A</span>
          {item.type === 'tv' ? 'Série' : 'Film'}
        </p>
        <h1 className="line-clamp-2 font-display text-4xl leading-[0.95] text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.8)] md:text-6xl xl:text-7xl">
          {item.title}
        </h1>
        <p className="mt-4 line-clamp-3 max-w-xl text-sm text-neutral-100 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] md:text-base xl:text-lg">
          {item.overview || item.tagline}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => onPlay(item)}
            className="inline-flex items-center gap-2 rounded bg-white px-6 py-2.5 text-base font-semibold text-black transition hover:bg-white/80 md:px-8 md:text-lg"
          >
            <Play className="h-6 w-6 fill-current" /> Lecture
          </button>
          <button
            type="button"
            onClick={() => onInfo(item)}
            className="inline-flex items-center gap-2 rounded bg-neutral-500/60 px-6 py-2.5 text-base font-semibold text-white backdrop-blur transition hover:bg-neutral-500/40 md:px-8 md:text-lg"
          >
            <Info className="h-6 w-6" /> Plus d'infos
          </button>
        </div>
      </div>
    </div>
  );
}

export function Hero({ items, onPlay, onInfo }: Props) {
  if (items.length === 0) return null;
  return (
    <section className="relative h-[78vw] max-h-[92vh] min-h-[540px] w-full overflow-hidden md:h-[56.25vw]">
      <Swiper
        key={items.map((item) => item.id).join('|')}
        modules={[Autoplay, Mousewheel, Keyboard]}
        className="h-full w-full"
        slidesPerView={1}
        loop={items.length > 1}
        speed={900}
        grabCursor
        keyboard={{ enabled: true, onlyInViewport: true }}
        mousewheel={{ forceToAxis: true, thresholdDelta: 20 }}
        autoplay={items.length > 1 ? { delay: 10000, disableOnInteraction: false, pauseOnMouseEnter: false } : false}
      >
        {items.map((item) => (
          <SwiperSlide key={item.id} className="h-full">
            {({ isActive }) => <HeroSlide item={item} active={isActive} onPlay={onPlay} onInfo={onInfo} />}
          </SwiperSlide>
        ))}
      </Swiper>
    </section>
  );
}
