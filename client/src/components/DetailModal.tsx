import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Check, Clapperboard, Download, ImageOff, ListX, Play, Plus, Star, X } from 'lucide-react';
import type { MediaFileDTO, MediaItem, MediaType } from '../types';
import { api, downloadUrl, imageUrl } from '../lib/api';

function DownloadLink({ file, label, className }: { file: MediaFileDTO; label?: string; className: string }) {
  const href = downloadUrl(file);
  if (!href) return null;
  return (
    <a
      href={href}
      download={file.name}
      target={__VITRINE__ ? '_blank' : undefined}
      rel="noopener noreferrer"
      title={`Télécharger ${file.name}`}
      aria-label={`Télécharger ${file.name}`}
      onClick={(event) => event.stopPropagation()}
      className={className}
    >
      <Download className="h-5 w-5" />
      {label}
    </a>
  );
}
import { itemProgress, progressRatio, resumeFileId } from '../lib/catalog';
import { capitalize, episodeLabel, formatRating, formatSize, itemMeta } from '../lib/format';
import type { ProgressEntry } from '../lib/storage';

interface Props {
  item: MediaItem;
  all: MediaItem[];
  progress: Record<string, ProgressEntry>;
  isFavorite: boolean;
  tmdbEnabled: boolean;
  onClose: () => void;
  onPlay: (item: MediaItem, fileId?: string) => void;
  onToggleFavorite: (id: string) => void;
  onRemoveProgress: (id: string) => void;
  onSelect: (item: MediaItem) => void;
  onFilterGenre: (genre: string) => void;
  onRematched: () => void;
}

export function DetailModal({
  item,
  all,
  progress,
  isFavorite,
  tmdbEnabled,
  onClose,
  onPlay,
  onToggleFavorite,
  onRemoveProgress,
  onSelect,
  onFilterGenre,
  onRematched
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showTrailer, setShowTrailer] = useState(false);
  const [showAllCast, setShowAllCast] = useState(false);
  const seasons = useMemo(() => [...new Set(item.files.map((file) => file.season ?? 0))].sort((a, b) => a - b), [item]);
  const [season, setSeason] = useState<number>(seasons[0] ?? 0);
  const [matchId, setMatchId] = useState('');
  const [matchType, setMatchType] = useState<MediaType>(item.type);
  const [matchState, setMatchState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  const last = itemProgress(item, progress);
  const resumeId = resumeFileId(item, progress);
  const resumeFile = item.files.find((file) => file.id === resumeId);
  const resuming = Boolean(last && resumeId === last.fileId && progressRatio(last) > 0.01);

  useEffect(() => {
    setShowTrailer(false);
    setShowAllCast(false);
    setSeason(resumeFile?.season ?? seasons[0] ?? 0);
    setMatchType(item.type);
    setMatchId('');
    setMatchState({ busy: false, error: null });
    scrollRef.current?.scrollTo({ top: 0 });
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const similar = useMemo(
    () =>
      all
        .filter((other) => other.id !== item.id && other.genres.some((genre) => item.genres.includes(genre)))
        .map((other) => ({
          other,
          score:
            other.genres.filter((genre) => item.genres.includes(genre)).length * 2 +
            other.keywords.filter((keyword) => item.keywords.includes(keyword)).length * 3 +
            (other.type === item.type ? 1 : 0) +
            other.rating / 10
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 9)
        .map((entry) => entry.other),
    [all, item]
  );

  const episodes = item.files.filter((file) => (file.season ?? 0) === season);
  const backdrop = imageUrl(item.backdrop) ?? imageUrl(item.poster);
  const cast = showAllCast ? item.cast : item.cast.slice(0, 5);

  const submitMatch = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const id = Number(matchId);
    if (!Number.isInteger(id) || id <= 0) {
      setMatchState({ busy: false, error: 'Indiquez un ID TMDB numérique.' });
      return;
    }
    setMatchState({ busy: true, error: null });
    try {
      await api.match(item.id, id, matchType);
      setMatchState({ busy: false, error: null });
      onRematched();
    } catch (failure) {
      setMatchState({ busy: false, error: failure instanceof Error ? failure.message : 'Échec de la correction' });
    }
  };

  const seasonName = (value: number): string =>
    value === 0 ? 'Autres épisodes' : (item.seasons[String(value)]?.name ?? `Saison ${value}`);

  return (
    <motion.div
      ref={scrollRef}
      className="fixed inset-0 z-[70] overflow-y-auto bg-black/70 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={item.title}
    >
      <motion.article
        initial={{ opacity: 0, y: 60, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 40, scale: 0.96 }}
        transition={{ type: 'spring', damping: 26, stiffness: 260 }}
        className="relative mx-auto my-6 w-[calc(100%-1.5rem)] max-w-[920px] overflow-hidden rounded-lg bg-ap-panel shadow-[0_40px_120px_rgba(0,0,0,0.9)] ring-1 ring-white/10 md:my-10"
      >
        <div className="relative aspect-video w-full bg-black">
          {showTrailer && item.trailer ? (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${item.trailer}?autoplay=1&rel=0&playsinline=1&origin=${encodeURIComponent(window.location.origin)}`}
              title={`Bande-annonce ${item.title}`}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
            />
          ) : (
            <>
              {backdrop ? (
                <img src={backdrop} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full w-full place-items-center bg-linear-to-br from-[#3a0a0e] to-black text-neutral-600">
                  <ImageOff className="h-12 w-12" />
                </div>
              )}
              <div className="absolute inset-0 bg-linear-to-t from-ap-panel via-ap-panel/30 to-transparent" />
              <div className="absolute bottom-6 left-6 right-6 md:bottom-10 md:left-12">
                <h2 className="max-w-xl font-display text-4xl leading-[0.9] text-white drop-shadow-[0_4px_20px_rgba(0,0,0,0.8)] md:text-6xl">
                  {item.title}
                </h2>
                {item.tagline && <p className="mt-2 max-w-xl text-sm italic text-neutral-300">{item.tagline}</p>}
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!resumeId}
                    onClick={() => onPlay(item, resumeId)}
                    className="inline-flex items-center gap-2 rounded bg-white px-6 py-2 text-base font-semibold text-black transition hover:bg-white/80 disabled:opacity-50"
                  >
                    <Play className="h-5 w-5 fill-current" />
                    {resuming ? 'Reprendre' : 'Lecture'}
                    {item.type === 'tv' && resumeFile && <span className="text-sm font-normal">{episodeLabel(resumeFile)}</span>}
                  </button>
                  {resumeFile && (
                    <DownloadLink
                      file={resumeFile}
                      label="Télécharger"
                      className="inline-flex items-center gap-2 rounded bg-neutral-500/60 px-5 py-2 text-base font-semibold text-white backdrop-blur transition hover:bg-neutral-500/40"
                    />
                  )}
                  <button
                    type="button"
                    aria-label={isFavorite ? 'Retirer de Ma liste' : 'Ajouter à Ma liste'}
                    title={isFavorite ? 'Retirer de Ma liste' : 'Ajouter à Ma liste'}
                    onClick={() => onToggleFavorite(item.id)}
                    className="grid h-10 w-10 place-items-center rounded-full border-2 border-white/50 bg-black/40 text-white transition hover:border-white"
                  >
                    {isFavorite ? <Check className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
                  </button>
                  {resuming && (
                    <button
                      type="button"
                      aria-label="Retirer de Reprendre la lecture"
                      title="Retirer de Reprendre la lecture"
                      onClick={() => onRemoveProgress(item.id)}
                      className="grid h-10 w-10 place-items-center rounded-full border-2 border-white/50 bg-black/40 text-white transition hover:border-white"
                    >
                      <ListX className="h-5 w-5" />
                    </button>
                  )}
                  {item.trailer && (
                    <button
                      type="button"
                      onClick={() => setShowTrailer(true)}
                      className="inline-flex items-center gap-2 rounded-full border-2 border-white/50 bg-black/40 px-4 py-1.5 text-sm text-white transition hover:border-white"
                    >
                      <Clapperboard className="h-4 w-4" /> Bande-annonce
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-[#181818] text-white ring-1 ring-white/20 transition hover:bg-neutral-700"
          >
            <X className="h-5 w-5" />
          </button>
          {showTrailer && (
            <button
              type="button"
              onClick={() => setShowTrailer(false)}
              className="absolute left-4 top-4 z-10 rounded bg-black/70 px-3 py-1.5 text-sm text-white hover:bg-black"
            >
              Fermer la bande-annonce
            </button>
          )}
        </div>

        {last && progressRatio(last) > 0.01 && progressRatio(last) < 0.95 && (
          <div className="mx-6 h-1 overflow-hidden rounded bg-white/15 md:mx-12">
            <div className="h-full bg-ap-red" style={{ width: `${Math.round(progressRatio(last) * 100)}%` }} />
          </div>
        )}

        <div className="grid gap-6 px-6 py-6 md:grid-cols-[2fr_1fr] md:px-12">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-300">
              {item.rating > 0 && (
                <span className="inline-flex items-center gap-1.5 font-semibold text-amber-400">
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                  <span>{formatRating(item.rating)} / 10</span>
                  {item.voteCount > 0 && <span className="font-normal text-neutral-400">({item.voteCount.toLocaleString('fr-FR')} votes TMDB)</span>}
                </span>
              )}
              {item.year && <span>{item.year}</span>}
              {itemMeta(item) && <span>{itemMeta(item)}</span>}
              <span className="rounded border border-white/40 px-1.5 text-[11px] uppercase">{item.type === 'tv' ? 'Série' : 'Film'}</span>
            </div>
            <p className="mt-4 leading-relaxed text-neutral-100">
              {item.overview || (item.tmdbId ? 'Synopsis indisponible.' : 'Titre non identifié sur TMDB.')}
            </p>
          </div>
          <div className="space-y-3 text-sm">
            {item.cast.length > 0 && (
              <p>
                <span className="text-neutral-500">Distribution : </span>
                <span className="text-neutral-200">{cast.join(', ')}</span>
                {item.cast.length > 5 && (
                  <button type="button" onClick={() => setShowAllCast((value) => !value)} className="ml-1 italic text-neutral-400 hover:text-white">
                    {showAllCast ? 'moins' : 'plus'}
                  </button>
                )}
              </p>
            )}
            {item.directors.length > 0 && (
              <p>
                <span className="text-neutral-500">{item.type === 'tv' ? 'Création : ' : 'Réalisation : '}</span>
                <span className="text-neutral-200">{item.directors.join(', ')}</span>
              </p>
            )}
            {item.categories.length > 0 && (
              <p>
                <span className="text-neutral-500">Catégorie : </span>
                {item.categories.map((category, index) => (
                  <span key={category}>
                    <button type="button" onClick={() => onFilterGenre(category)} className="text-neutral-200 hover:text-white hover:underline">
                      {category}
                    </button>
                    {index < item.categories.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </p>
            )}
            {item.genres.length > 0 && (
              <p>
                <span className="text-neutral-500">Genres : </span>
                <span className="text-neutral-200">{item.genres.join(', ')}</span>
              </p>
            )}
          </div>
        </div>

        {item.type === 'tv' && item.files.length > 0 && (
          <section className="px-6 pb-8 md:px-12">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="text-xl font-semibold text-white md:text-2xl">Épisodes</h3>
              {seasons.length > 1 ? (
                <select
                  value={season}
                  onChange={(event) => setSeason(Number(event.target.value))}
                  className="rounded border border-white/25 bg-[#242424] px-3 py-2 text-sm text-white outline-hidden focus:border-white"
                >
                  {seasons.map((value) => (
                    <option key={value} value={value}>
                      {seasonName(value)}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-sm text-neutral-400">{seasonName(season)}</span>
              )}
            </div>
            <ol className="divide-y divide-white/10 border-y border-white/10">
              {episodes.map((file) => {
                const meta =
                  file.season !== null && file.episode !== null ? item.seasons[String(file.season)]?.episodes[String(file.episode)] : undefined;
                const still = imageUrl(meta?.still) ?? backdrop;
                const ratio = progressRatio(progress[file.id] ?? null);
                return (
                  <li key={file.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onPlay(item, file.id)}
                      className={`group/ep flex min-w-0 flex-1 items-center gap-4 rounded-md px-2 py-4 text-left transition hover:bg-white/5 ${
                        file.id === resumeId ? 'bg-white/[0.04]' : ''
                      }`}
                    >
                      <span className="w-7 shrink-0 text-center text-xl text-neutral-400">{file.episode ?? '•'}</span>
                      <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded bg-neutral-800 md:w-40">
                        {still && <img src={still} alt="" loading="lazy" className="h-full w-full object-cover" />}
                        <div className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition group-hover/ep:opacity-100">
                          <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-white bg-black/50">
                            <Play className="h-4 w-4 fill-current" />
                          </span>
                        </div>
                        {ratio > 0 && (
                          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
                            <div className="h-full bg-ap-red" style={{ width: `${Math.round(ratio * 100)}%` }} />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="truncate font-medium text-white">{meta?.name ?? episodeLabel(file)}</p>
                          <span className="shrink-0 text-sm text-neutral-400">{meta?.runtime ? `${meta.runtime} min` : ''}</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-neutral-400">{meta?.overview || file.name}</p>
                      </div>
                    </button>
                    <DownloadLink
                      file={file}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-neutral-400 transition hover:bg-white/10 hover:text-white"
                    />
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {item.type === 'movie' && item.files.length > 1 && (
          <section className="px-6 pb-8 md:px-12">
            <h3 className="mb-3 text-xl font-semibold text-white">Versions disponibles</h3>
            <ul className="space-y-2">
              {item.files.map((file) => (
                <li key={file.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onPlay(item, file.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded bg-white/5 px-4 py-3 text-left text-sm hover:bg-white/10"
                  >
                    <Play className="h-4 w-4 shrink-0 fill-current" />
                    <span className="min-w-0 flex-1 truncate text-neutral-200">{file.name}</span>
                    <span className="shrink-0 text-neutral-500">{formatSize(file.size)}</span>
                  </button>
                  <DownloadLink
                    file={file}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded bg-white/5 text-neutral-300 transition hover:bg-white/10 hover:text-white"
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        {similar.length > 0 && (
          <section className="px-6 pb-8 md:px-12">
            <h3 className="mb-4 text-xl font-semibold text-white md:text-2xl">Titres similaires</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {similar.map((other) => {
                const art = imageUrl(other.backdrop) ?? imageUrl(other.poster);
                return (
                  <button
                    type="button"
                    key={other.id}
                    onClick={() => onSelect(other)}
                    className="group/sim overflow-hidden rounded-md bg-[#2f2f2f] text-left transition hover:bg-[#3a3a3a]"
                  >
                    <div className="relative aspect-video overflow-hidden bg-neutral-800">
                      {art && (
                        <img src={art} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover/sim:scale-105" />
                      )}
                      <span className="absolute right-2 top-2 rounded bg-black/70 px-1.5 text-xs text-white">{other.year}</span>
                    </div>
                    <div className="p-3">
                      <p className="line-clamp-1 text-sm font-semibold text-white">{other.title}</p>
                      <p className="mt-1 line-clamp-3 text-xs text-neutral-400">{other.overview}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {!__VITRINE__ && (
        <details className="border-t border-white/10 px-6 py-5 text-sm text-neutral-400 md:px-12">
          <summary className="cursor-pointer select-none hover:text-white">Corriger l'identification TMDB · fichiers sources</summary>
          <form onSubmit={submitMatch} className="mt-4 flex flex-wrap items-center gap-2">
            <input
              value={matchId}
              onChange={(event) => setMatchId(event.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              placeholder="ID TMDB (ex : 603)"
              disabled={!tmdbEnabled}
              className="w-44 rounded border border-white/20 bg-[#242424] px-3 py-2 text-white outline-hidden focus:border-white"
            />
            <select
              value={matchType}
              onChange={(event) => setMatchType(event.target.value as MediaType)}
              disabled={!tmdbEnabled}
              className="rounded border border-white/20 bg-[#242424] px-3 py-2 text-white outline-hidden"
            >
              <option value="movie">Film</option>
              <option value="tv">Série</option>
            </select>
            <button
              type="submit"
              disabled={!tmdbEnabled || matchState.busy}
              className="rounded bg-ap-red px-4 py-2 font-semibold text-white hover:bg-[#f6121d] disabled:opacity-50"
            >
              {matchState.busy ? 'Correction…' : 'Appliquer'}
            </button>
            {!tmdbEnabled && <span className="text-xs">TMDB_API_KEY absente du .env.</span>}
            {matchState.error && <span className="text-xs text-[#ffb45a]">{matchState.error}</span>}
          </form>
          <p className="mt-2 text-xs text-neutral-500">L'ID se trouve dans l'URL TMDB : themoviedb.org/movie/603 → 603.</p>
          <ul className="mt-3 space-y-1 text-xs text-neutral-500">
            {item.files.map((file) => (
              <li key={file.id} className="truncate">
                {file.name} · {formatSize(file.size)}
              </li>
            ))}
          </ul>
        </details>
        )}
      </motion.article>
    </motion.div>
  );
}
