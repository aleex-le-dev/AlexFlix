import { useEffect, useMemo, useState } from 'react';
import { motion, useDragControls } from 'framer-motion';
import { Check, Clapperboard, Download, Play, Plus, Star, X } from 'lucide-react';
import type { MediaItem } from '../types';
import { artUrl, downloadUrl } from '../lib/api';
import { formatRating, isUhd, itemMeta } from '../lib/format';
import { getProgressMap } from '../lib/storage';
import { lockScroll } from '../lib/scrollLock';
import { SmoothImg } from './SmoothImg';
import { TrailerFullscreen } from './TrailerFullscreen';

interface Props {
  item: MediaItem;
  isFavorite: boolean;
  progress: number;
  onPlay: (item: MediaItem, fileId?: string) => void;
  onToggleFavorite: (id: string) => void;
  /** Films de la même saga (ordre des épisodes), affichés en bas de l'aperçu. */
  saga: MediaItem[];
  onSelect: (item: MediaItem) => void;
  onSearchPerson: (name: string) => void;
  onClose: () => void;
}

/** Mobile : aperçu rapide au toucher d'une affiche (panneau du bas), avant la fiche complète. */
/** Aperçu mobile complet (plus besoin de la fiche) : lecture, Ma liste, bande-annonce, épisodes, casting, saga. */
export function QuickSheet({ item, isFavorite, progress, onPlay, onToggleFavorite, saga, onSelect, onSearchPerson, onClose }: Props) {
  useEffect(() => lockScroll(), []);
  const art = artUrl(item.backdrop, 'md') ?? artUrl(item.poster, 'md');
  const meta = itemMeta(item);
  // Le panneau défile (épisodes) : on ne le ferme en glissant que depuis l'image du haut.
  const dragControls = useDragControls();
  const seasons = useMemo(() => [...new Set(item.files.map((file) => file.season ?? 0))].sort((a, b) => a - b), [item]);
  const progressMap = getProgressMap();
  const startSeason = useMemo(() => {
    let latest: { season: number; at: number } | null = null;
    for (const file of item.files) {
      const entry = progressMap[file.id];
      if (entry && (!latest || entry.updatedAt > latest.at)) latest = { season: file.season ?? 0, at: entry.updatedAt };
    }
    return latest?.season ?? seasons[0] ?? 0;
  }, [item]); // eslint-disable-line react-hooks/exhaustive-deps
  const [season, setSeason] = useState(startSeason);
  const episodes = item.files.filter((file) => (file.season ?? 0) === season);
  const [trailerOpen, setTrailerOpen] = useState(false);
  const download = item.type === 'movie' && item.files[0] ? downloadUrl(item.files[0]) : null;
  const sagaOthers = saga.filter((other) => other.id !== item.id);
  const openTrailer = (): void => {
    setTrailerOpen(true);
    // Plein écran demandé pendant le toucher (sinon refusé par le navigateur).
    void document.documentElement
      .requestFullscreen?.()
      .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
      .catch(() => undefined);
  };
  const people = (label: string, names: string[]) =>
    names.length > 0 && (
      <p className="text-sm text-neutral-400">
        {label} :{' '}
        {names.map((name, index) => (
          <span key={name}>
            {index > 0 && ', '}
            <button type="button" onClick={() => onSearchPerson(name)} className="text-neutral-200 underline-offset-2 active:underline">
              {name}
            </button>
          </span>
        ))}
      </p>
    );

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
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.6 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 90 || info.velocity.y > 500) onClose();
        }}
        className="fixed inset-x-0 bottom-0 z-[76] max-h-[92vh] overflow-y-auto overscroll-contain rounded-t-3xl bg-[#181818] pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[0_-20px_60px_rgba(0,0,0,0.6)] ring-1 ring-white/10"
      >
        <div className="relative aspect-video w-full touch-none bg-neutral-900" onPointerDown={(event) => dragControls.start(event)}>
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
            {item.trailer && (
              <button type="button" onClick={openTrailer} aria-label="Bande-annonce" className="flex flex-col items-center gap-1 px-1 text-[11px] text-neutral-300">
                <span className="grid h-10 w-10 place-items-center rounded-full ring-1 ring-white/30">
                  <Clapperboard className="h-5 w-5 text-white" />
                </span>
                Bande-annonce
              </button>
            )}
            {download && (
              <a
                href={download}
                download={item.files[0]?.name}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Télécharger"
                className="flex flex-col items-center gap-1 px-1 text-[11px] text-neutral-300"
              >
                <span className="grid h-10 w-10 place-items-center rounded-full ring-1 ring-white/30">
                  <Download className="h-5 w-5 text-white" />
                </span>
                Télécharger
              </a>
            )}
          </div>

          {/* Séries : saisons et épisodes directement dans l'aperçu (on fait défiler). */}
          {item.type === 'tv' && item.files.length > 0 && (
            <section className="mt-6 border-t border-white/10 pt-4">
              <div className="flex items-baseline justify-between">
                <h3 className="text-lg font-semibold text-white">Épisodes</h3>
                <span className="text-xs text-neutral-400">
                  {episodes.length} épisode{episodes.length > 1 ? 's' : ''}
                </span>
              </div>
              {seasons.length > 1 && (
                <div className="no-scrollbar -mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1">
                  {seasons.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSeason(value)}
                      className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                        value === season ? 'bg-white text-black' : 'bg-white/10 text-neutral-200 ring-1 ring-white/10'
                      }`}
                    >
                      {value === 0 ? 'Bonus' : `Saison ${value}`}
                    </button>
                  ))}
                </div>
              )}
              <ol className="mt-3 space-y-3">
                {episodes.map((file) => {
                  const meta = file.season !== null && file.episode !== null ? item.seasons[String(file.season)]?.episodes[String(file.episode)] : undefined;
                  const still = artUrl(meta?.still) ?? art;
                  const entry = progressMap[file.id];
                  const ratio = entry && entry.duration > 0 ? Math.min(1, entry.position / entry.duration) : 0;
                  return (
                    <li key={file.id}>
                      <button type="button" onClick={() => onPlay(item, file.id)} className="flex w-full items-center gap-3 text-left active:opacity-70">
                        <span className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-md bg-neutral-800">
                          {still && <SmoothImg src={still} alt="" loading="lazy" className="h-full w-full object-cover" />}
                          <span className="absolute inset-0 grid place-items-center bg-black/25">
                            <Play className="h-6 w-6 fill-white text-white drop-shadow" />
                          </span>
                          {ratio > 0.01 && (
                            <span className="absolute inset-x-1 bottom-1 h-1 overflow-hidden rounded bg-white/25">
                              <span className="block h-full bg-ap-red" style={{ width: `${Math.round(ratio * 100)}%` }} />
                            </span>
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-xs font-semibold text-neutral-400">Épisode {file.episode ?? '•'}</span>
                          <span className="line-clamp-2 block text-sm font-medium text-white">{meta?.name || file.name}</span>
                          {meta?.runtime ? <span className="block text-xs text-neutral-400">{meta.runtime} min</span> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {(item.cast.length > 0 || item.directors.length > 0) && (
            <section className="mt-6 space-y-1.5 border-t border-white/10 pt-4">
              {people('Distribution', item.cast.slice(0, 6))}
              {people(item.type === 'tv' ? 'Création' : 'Réalisation', item.directors)}
              {item.genres.length > 0 && <p className="text-sm text-neutral-400">Genres : <span className="text-neutral-200">{item.genres.join(', ')}</span></p>}
            </section>
          )}

          {sagaOthers.length > 0 && (
            <section className="mt-6 border-t border-white/10 pt-4">
              <h3 className="text-lg font-semibold text-white">De la même saga</h3>
              <div className="no-scrollbar -mx-5 mt-3 flex gap-3 overflow-x-auto px-5 pb-1">
                {sagaOthers.map((other) => (
                  <button key={other.id} type="button" onClick={() => onSelect(other)} className="w-36 shrink-0 text-left active:opacity-70">
                    <span className="relative block aspect-[2/3] overflow-hidden rounded-md bg-neutral-800">
                      {artUrl(other.poster, 'sm') && <SmoothImg src={artUrl(other.poster, 'sm') ?? undefined} alt={other.title} loading="lazy" className="h-full w-full object-cover" />}
                    </span>
                    <span className="mt-1.5 line-clamp-2 block text-xs font-medium text-white">{other.title}</span>
                    {other.year && <span className="block text-[11px] text-neutral-400">{other.year}</span>}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </motion.div>
      {trailerOpen && item.trailer && <TrailerFullscreen videoKey={item.trailer} title={item.title} onClose={() => setTrailerOpen(false)} />}
    </>
  );
}
