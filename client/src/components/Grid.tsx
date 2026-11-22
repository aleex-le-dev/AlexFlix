import { motion } from 'framer-motion';
import type { MediaItem } from '../types';
import { itemProgress, progressRatio } from '../lib/catalog';
import type { ProgressEntry } from '../lib/storage';
import { MediaCard } from './MediaCard';

interface Props {
  title: string;
  subtitle?: string;
  items: MediaItem[];
  progress: Record<string, ProgressEntry>;
  favorites: string[];
  emptyLabel: string;
  onOpen: (item: MediaItem) => void;
  onPlay: (item: MediaItem) => void;
  onToggleFavorite: (id: string) => void;
}

export function Grid({ title, subtitle, items, progress, favorites, emptyLabel, onOpen, onPlay, onToggleFavorite }: Props) {
  return (
    <section className="px-4 pb-10 pt-4 md:px-12">
      {title && (
        <div className="mb-4 flex items-baseline gap-3">
          <h2 className="text-xl font-semibold text-white md:text-2xl">{title}</h2>
        </div>
      )}
      {items.length === 0 ? (
        <p className="py-20 text-center text-neutral-400">{emptyLabel}</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-2 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
          {items.map((item, index) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: Math.min(index, 24) * 0.02 }}
              className="relative hover:z-20"
            >
              <MediaCard
                item={item}
                progress={progressRatio(itemProgress(item, progress))}
                isFavorite={favorites.includes(item.id)}
                onOpen={onOpen}
                onPlay={onPlay}
                onToggleFavorite={onToggleFavorite}
              />
            </motion.div>
          ))}
        </div>
      )}
    </section>
  );
}
