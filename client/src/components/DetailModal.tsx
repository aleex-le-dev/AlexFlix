import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { motion, useDragControls } from 'framer-motion';
import { Check, Clapperboard, Download, ImageOff, ListX, Play, Plus, Star, X } from 'lucide-react';
import type { MediaFileDTO, MediaItem, MediaType } from '../types';
import { api, artUrl, downloadUrl } from '../lib/api';
import { lockScroll } from '../lib/scrollLock';

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
import { groupSagas, itemProgress, progressRatio, resumeFileId } from '../lib/catalog';
import { capitalize, episodeLabel, formatRating, formatSize, itemMeta, seasonCount } from '../lib/format';
import type { ProgressEntry } from '../lib/storage';
import { SmoothImg } from './SmoothImg';
import { TrailerFullscreen } from './TrailerFullscreen';
import { TrailerPlayer } from './TrailerPlayer';

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
  /** Clic sur un acteur / réalisateur : recherche de ses titres dans la bibliothèque. */
  onSearchPerson: (name: string) => void;
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
  onSearchPerson,
  onSelect,
  onFilterGenre,
  onRematched
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Mobile : glisser l'image du haut vers le bas ferme la fiche. */
  const dragControls = useDragControls();
  const touchDevice = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;
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
    const unlock = lockScroll();
    return () => {
      window.removeEventListener('keydown', onKey);
      unlock();
    };
  }, [onClose]);

  /** Même saga (même sous-dossier du disque), dans l'ordre des épisodes. */
  const saga = useMemo(() => {
    const key = item.collections?.[0];
    if (!key) return [];
    return groupSagas(all.filter((other) => other.id !== item.id && other.collections?.[0] === key));
  }, [all, item]);

  /**
   * Titres similaires, du plus proche au plus éloigné : mots-clés et genres TMDB communs, même catégorie,
   * même type, note. Les films d'une même saga sont regroupés et remis dans l'ordre.
   */
  const similar = useMemo(() => {
    const exclude = new Set([item.id, ...saga.map((other) => other.id)]);
    const ranked = all
      .filter((other) => !exclude.has(other.id) && other.genres.some((genre) => item.genres.includes(genre)))
      .map((other) => ({
        other,
        score:
          other.keywords.filter((keyword) => item.keywords.includes(keyword)).length * 3 +
          other.genres.filter((genre) => item.genres.includes(genre)).length * 2 +
          (other.categories.some((category) => item.categories.includes(category)) ? 2 : 0) +
          (other.type === item.type ? 1 : 0) +
          other.rating / 10
      }))
      .sort((a, b) => b.score - a.score || b.other.rating - a.other.rating)
      .slice(0, 30)
      .map((entry) => entry.other);
    return groupSagas(ranked);
  }, [all, item, saga]);

  /**
   * Cartes du bas de fiche. Dans « Titres similaires », les films d'un même dossier sont réunis
   * en une carte empilée : une saga (sous-dossier) ouvre son 1er film, un dossier de catégorie ouvre la catégorie.
   */
  type SimilarCard = {
    key: string;
    open: () => void;
    title: string;
    badge: string;
    label: string;
    text: string;
    art: string | null;
    stacked: boolean;
  };
  /** Série : « 3 saisons · 26 ép. » et, si elle est commencée, l'épisode où l'on en est. */
  const seriesInfo = (other: MediaItem): { badge: string; resume: string } => {
    const seasons = seasonCount(other);
    const episodes = other.files.length;
    const badge = `${seasons > 1 ? `${seasons} saisons · ` : ''}${episodes} ép.`;
    const last = itemProgress(other, progress);
    const file = last ? other.files.find((candidate) => candidate.id === last.fileId) : undefined;
    return { badge, resume: file && progressRatio(last) > 0.01 ? `En cours : ${episodeLabel(file)}` : '' };
  };
  const toCard = (other: MediaItem): SimilarCard => {
    const series = other.type === 'tv' ? seriesInfo(other) : null;
    return {
      key: other.id,
      open: () => onSelect(other),
      title: other.title,
      badge: series ? series.badge : other.year ? String(other.year) : '',
      label: series?.resume ?? '',
      text: series?.resume ? `${series.resume} · ${other.overview}` : other.overview,
      art: artUrl(other.backdrop, 'md') ?? artUrl(other.poster, 'md'),
      stacked: false
    };
  };
  const similarCards = useMemo<SimilarCard[]>(() => {
    const folderOf = (other: MediaItem): string => (other.collections?.[0] ? `saga:${other.collections[0]}` : `dossier:${other.categories[0] ?? ''}`);
    const cards: SimilarCard[] = [];
    const seen = new Set<string>();
    for (const other of similar) {
      const folder = folderOf(other);
      if (seen.has(folder)) continue;
      seen.add(folder);
      const isSaga = folder.startsWith('saga:');
      const name = folder.slice(folder.indexOf(':') + 1);
      // Saga : tous ses films ; dossier de catégorie : seulement ceux retenus comme similaires.
      const members = groupSagas(
        isSaga
          ? all.filter((candidate) => candidate.id !== item.id && candidate.collections?.[0] === name)
          : similar.filter((candidate) => folderOf(candidate) === folder)
      );
      if (members.length < 2 || !name) {
        for (const member of members.length ? members : [other]) cards.push(toCard(member));
        continue;
      }
      const unit = members.every((member) => member.type === 'tv') ? 'séries' : 'films';
      cards.push({
        key: folder,
        open: isSaga ? () => onSelect(members[0]) : () => onFilterGenre(name),
        title: isSaga ? (name.split(' · ').pop() ?? name) : name,
        badge: `${members.length} ${unit}`,
        label: isSaga ? 'Saga' : 'Dossier',
        text: members.map((member) => (member.type === 'tv' ? `${member.title} (${seriesInfo(member).badge})` : member.title)).join(' · '),
        art: artUrl(members[0].backdrop, 'md') ?? artUrl(members[0].poster, 'md'),
        stacked: true
      });
    }
    return cards.slice(0, 9);
  }, [similar, all, item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const episodes = item.files.filter((file) => (file.season ?? 0) === season);
  const backdrop = artUrl(item.backdrop, 'hd') ?? artUrl(item.poster, 'md');
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
        drag={touchDevice ? 'y' : false}
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.7 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 110 || info.velocity.y > 600) onClose();
        }}
        className="relative mx-auto my-6 w-[calc(100%-1.5rem)] max-w-[920px] overflow-hidden rounded-lg bg-ap-panel shadow-[0_40px_120px_rgba(0,0,0,0.9)] ring-1 ring-white/10 md:my-10"
      >
        <div
          className="relative aspect-video w-full touch-pan-x bg-black"
          onPointerDown={(event) => {
            if (touchDevice && (scrollRef.current?.scrollTop ?? 0) <= 4) dragControls.start(event);
          }}
        >
          {touchDevice && <span aria-hidden="true" className="absolute left-1/2 top-2 z-20 h-1.5 w-10 -translate-x-1/2 rounded-full bg-white/60 shadow" />}
          {showTrailer && item.trailer && !touchDevice ? (
            <TrailerPlayer videoKey={item.trailer} title={item.title} onClose={() => setShowTrailer(false)} />
          ) : (
            <>
              {backdrop ? (
                <SmoothImg src={backdrop} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full w-full place-items-center bg-linear-to-br from-[#3a0a0e] to-black text-neutral-400">
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
                      onClick={() => {
                        setShowTrailer(true);
                        // Mobile : plein écran demandé pendant le toucher (sinon refusé), puis paysage si possible.
                        if (touchDevice) {
                          void document.documentElement
                            .requestFullscreen?.()
                            .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
                            .catch(() => undefined);
                        }
                      }}
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
                <span className="text-neutral-400">Distribution : </span>
                <span className="text-neutral-200">
                  {cast.map((name, index) => (
                    <span key={name}>
                      {index > 0 && ', '}
                      <button
                        type="button"
                        onClick={() => onSearchPerson(name)}
                        title={`Voir les titres avec ${name}`}
                        className="text-neutral-200 underline-offset-2 transition hover:text-white hover:underline"
                      >
                        {name}
                      </button>
                    </span>
                  ))}
                </span>
                {item.cast.length > 5 && (
                  <button type="button" onClick={() => setShowAllCast((value) => !value)} className="ml-1 italic text-neutral-400 hover:text-white">
                    {showAllCast ? 'moins' : 'plus'}
                  </button>
                )}
              </p>
            )}
            {item.directors.length > 0 && (
              <p>
                <span className="text-neutral-400">{item.type === 'tv' ? 'Création : ' : 'Réalisation : '}</span>
                <span className="text-neutral-200">
                  {item.directors.map((name, index) => (
                    <span key={name}>
                      {index > 0 && ', '}
                      <button
                        type="button"
                        onClick={() => onSearchPerson(name)}
                        title={`Voir les titres avec ${name}`}
                        className="text-neutral-200 underline-offset-2 transition hover:text-white hover:underline"
                      >
                        {name}
                      </button>
                    </span>
                  ))}
                </span>
              </p>
            )}
            {item.categories.length > 0 && (
              <p>
                <span className="text-neutral-400">Catégorie : </span>
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
                <span className="text-neutral-400">Genres : </span>
                <span className="text-neutral-200">{item.genres.join(', ')}</span>
              </p>
            )}
          </div>
        </div>

        {item.type === 'tv' && item.files.length > 0 && (
          <section className="px-6 pb-8 md:px-12">
            <div className="mb-4">
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="text-xl font-semibold text-white md:text-2xl">Épisodes</h3>
                <span className="text-sm text-neutral-400">
                  {episodes.length} épisode{episodes.length > 1 ? 's' : ''}
                </span>
              </div>
              {seasons.length > 1 ? (
                <div className="no-scrollbar -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Saisons">
                  {seasons.map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={value === season}
                      onClick={() => setSeason(value)}
                      className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                        value === season ? 'bg-white text-black' : 'bg-white/10 text-neutral-200 ring-1 ring-white/10 hover:bg-white/20'
                      }`}
                    >
                      {seasonName(value)}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-sm text-neutral-400">{seasonName(season)}</p>
              )}
            </div>
            <ol className="divide-y divide-white/10 border-y border-white/10">
              {episodes.map((file) => {
                const meta =
                  file.season !== null && file.episode !== null ? item.seasons[String(file.season)]?.episodes[String(file.episode)] : undefined;
                const still = artUrl(meta?.still) ?? backdrop;
                const ratio = progressRatio(progress[file.id] ?? null);
                return (
                  <li key={file.id} className="flex items-center gap-2">
                    {/* Mobile : vignette + titre complet, résumé en dessous sur toute la largeur ; toucher = lecture. */}
                    <button
                      type="button"
                      onClick={() => onPlay(item, file.id)}
                      className={`group/ep block min-w-0 flex-1 rounded-md px-2 py-4 text-left transition hover:bg-white/5 ${
                        file.id === resumeId ? 'bg-white/[0.04]' : ''
                      }`}
                    >
                      <span className="flex items-center gap-3 md:gap-4">
                        <span className="hidden w-7 shrink-0 text-center text-xl text-neutral-400 md:block">{file.episode ?? '•'}</span>
                        <span className="relative block aspect-video w-36 shrink-0 overflow-hidden rounded bg-neutral-800 md:w-40">
                          {still && <SmoothImg src={still} alt="" loading="lazy" className="h-full w-full object-cover" />}
                          <span className="absolute inset-0 grid place-items-center bg-black/30 transition md:bg-black/40 md:opacity-0 md:group-hover/ep:opacity-100">
                            <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-white bg-black/50">
                              <Play className="h-4 w-4 fill-current" />
                            </span>
                          </span>
                          {ratio > 0 && (
                            <span className="absolute inset-x-0 bottom-0 h-1 bg-white/25">
                              <span className="block h-full bg-ap-red" style={{ width: `${Math.round(ratio * 100)}%` }} />
                            </span>
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-semibold text-neutral-400">
                            Épisode {file.episode ?? '•'}
                            {meta?.runtime ? ` · ${meta.runtime} min` : ''}
                          </span>
                          <span className="mt-0.5 line-clamp-2 block font-medium leading-snug text-white">{meta?.name ?? episodeLabel(file)}</span>
                          <span className="mt-1 hidden text-sm text-neutral-400 md:line-clamp-2">{meta?.overview || file.name}</span>
                        </span>
                      </span>
                      {(meta?.overview || file.name) && (
                        <span className="mt-2 line-clamp-3 block text-sm leading-relaxed text-neutral-400 md:hidden">{meta?.overview || file.name}</span>
                      )}
                    </button>
                    <DownloadLink
                      file={file}
                      className="hidden h-10 w-10 shrink-0 place-items-center rounded-full text-neutral-400 transition hover:bg-white/10 hover:text-white md:grid"
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
                    <span className="shrink-0 text-neutral-400">{formatSize(file.size)}</span>
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

        {[
          { id: 'saga', title: item.collections?.[0] ? `De la même saga · ${item.collections[0]}` : '', list: saga.map(toCard) },
          { id: 'similar', title: 'Titres similaires', list: similarCards }
        ]
          .filter((block) => block.list.length > 0)
          .map((block) => (
          <section key={block.id} className="px-6 pb-8 md:px-12">
            <h3 className="mb-4 text-xl font-semibold text-white md:text-2xl">{block.title}</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {block.list.map((card) => (
                <button
                  type="button"
                  key={card.key}
                  onClick={card.open}
                  title={card.stacked ? `${card.label} ${card.title}` : card.title}
                  className={`group/sim relative text-left ${card.stacked ? 'mt-2' : ''}`}
                >
                  {card.stacked && (
                    <>
                      <span aria-hidden="true" className="absolute inset-x-4 -top-2 h-4 rounded-t-md bg-[#2a2a2a] ring-1 ring-white/5" />
                      <span aria-hidden="true" className="absolute inset-x-2 -top-1 h-4 rounded-t-md bg-[#353535] ring-1 ring-white/5" />
                    </>
                  )}
                  <span className="relative block overflow-hidden rounded-md bg-[#2f2f2f] transition group-hover/sim:bg-[#3a3a3a]">
                    <span className="relative block aspect-video overflow-hidden bg-neutral-800">
                      {card.art && (
                        <SmoothImg src={card.art} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover/sim:scale-105" />
                      )}
                      {card.badge && (
                        <span className={`absolute right-2 top-2 rounded px-1.5 text-xs font-semibold text-white ${card.stacked ? 'bg-ap-red' : 'bg-black/70'}`}>
                          {card.badge}
                        </span>
                      )}
                      {card.stacked && (
                        <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 text-[10px] font-bold uppercase tracking-wider text-white">{card.label}</span>
                      )}
                      {!card.stacked && card.label && (
                        <span className="absolute bottom-2 left-2 rounded bg-ap-red px-1.5 py-0.5 text-[11px] font-semibold text-white">{card.label}</span>
                      )}
                    </span>
                    <span className="block p-3">
                      <span className="line-clamp-1 text-sm font-semibold text-white">{card.title}</span>
                      <span className={`mt-1 line-clamp-3 text-xs ${card.stacked ? 'text-neutral-300' : 'text-neutral-400'}`}>{card.text}</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
          ))}

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
          <p className="mt-2 text-xs text-neutral-400">L'ID se trouve dans l'URL TMDB : themoviedb.org/movie/603 → 603.</p>
          <ul className="mt-3 space-y-1 text-xs text-neutral-400">
            {item.files.map((file) => (
              <li key={file.id} className="truncate">
                {file.name} · {formatSize(file.size)}
              </li>
            ))}
          </ul>
        </details>
        )}
        {/* Mobile : bande-annonce directement en plein écran. */}
        {touchDevice && showTrailer && item.trailer && (
          <TrailerFullscreen videoKey={item.trailer} title={item.title} onClose={() => setShowTrailer(false)} />
        )}
      </motion.article>
    </motion.div>
  );
}
