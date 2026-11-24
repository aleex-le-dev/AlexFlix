import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ListVideo,
  LoaderCircle,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipForward,
  Volume2,
  VolumeX
} from 'lucide-react';
import type { MediaItem, StreamInfo } from '../types';
import { api, artUrl, audioTrackUrl, streamUrl, transcodeUrl } from '../lib/api';
import { lockScroll } from '../lib/scrollLock';
import { hasNoAudio, openInVlc, supportsDolby, vlcHint } from '../lib/externalPlayer';
import { episodeLabel, formatClock } from '../lib/format';
import { getPrefs, getProgressMap, notifyStorage, saveProgress, setPrefs } from '../lib/storage';

interface Props {
  item: MediaItem;
  fileId: string;
  onClose: () => void;
  onChangeFile: (fileId: string) => void;
  /** Films de la même saga (ordre des épisodes), pour le panneau « Saga » du lecteur. */
  saga?: MediaItem[];
  onPlayItem?: (item: MediaItem) => void;
}

type Mode = 'direct' | 'transcode';

const EMPTY_INFO: StreamInfo = {
  duration: null,
  videoCodec: null,
  audioCodec: null,
  width: null,
  height: null,
  audioLanguages: [],
  needsTranscode: false,
  transcodeAvailable: false,
  reason: ''
};

function isBuffered(video: HTMLVideoElement, time: number): boolean {
  for (let i = 0; i < video.buffered.length; i++) {
    if (time >= video.buffered.start(i) && time <= video.buffered.end(i)) return true;
  }
  return false;
}

export function Player({ item, fileId, onClose, onChangeFile, saga = [], onPlayItem }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef(0);
  const lastSave = useRef(0);
  const pendingSeek = useRef<number | null>(null);
  const modeRef = useRef<Mode | null>(null);
  const offsetRef = useRef(0);
  const timeRef = useRef(0);
  const durationRef = useRef(0);
  const fileIdRef = useRef(fileId);

  const [info, setInfo] = useState<StreamInfo | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [src, setSrc] = useState('');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [waiting, setWaiting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Son non décodé par le navigateur (Dolby AC3/E-AC3, DTS) → proposition d'ouvrir dans VLC. */
  const [noAudio, setNoAudio] = useState(false);
  const audioCheck = useRef<{ start: number | null; done: boolean }>({ start: null, done: false });
  const [uiVisible, setUiVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [volume, setVolume] = useState(() => getPrefs().volume);
  const [muted, setMuted] = useState(() => getPrefs().muted);
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  /** « Regarder le générique » : masque la carte Épisode suivant pour ce fichier. */
  const [creditsMode, setCreditsMode] = useState(false);
  /** Panneau Épisodes (séries) / Saga (films) sous les commandes, façon Netflix. */
  const [listOpen, setListOpen] = useState(false);
  const [listSeason, setListSeason] = useState<number | null>(null);

  const index = item.files.findIndex((file) => file.id === fileId);
  const file = index >= 0 ? item.files[index] : item.files[0];
  /** Son séparé (AAC) : la vidéo est jouée en muet et cette piste suit sa position. */
  const audioRef = useRef<HTMLAudioElement>(null);
  // Piste AAC seulement si l'appareil ne décode pas le Dolby (sinon on garde le 5.1 d'origine).
  const [nativeDolby] = useState(supportsDolby);
  /** L'appareil se dit compatible Dolby mais ne sort aucun son : on bascule sur la piste AAC à la demande. */
  const [forceAac, setForceAac] = useState(false);
  const aacUrl = mode === 'direct' ? audioTrackUrl(fileId) : null;
  const sideAudio = aacUrl && (!nativeDolby || forceAac) ? aacUrl : null;
  const nextFile = item.type === 'tv' && index >= 0 ? (item.files[index + 1] ?? null) : null;
  const episodeMeta =
    file && file.season !== null && file.episode !== null ? item.seasons[String(file.season)]?.episodes[String(file.episode)] : undefined;
  const subtitle =
    item.type === 'tv' && file ? `${episodeLabel(file)}${episodeMeta?.name ? ` · ${episodeMeta.name}` : ''}` : item.year ? String(item.year) : '';

  const persist = useCallback(
    (notify: boolean, finished = false) => {
      const total = durationRef.current;
      const position = finished ? total : timeRef.current;
      if (total > 0 && position > 5) {
        saveProgress({ itemId: item.id, fileId: fileIdRef.current, position, duration: total, updatedAt: Date.now() }, notify);
      }
    },
    [item.id]
  );

  const startDirect = useCallback((at: number) => {
    modeRef.current = 'direct';
    offsetRef.current = 0;
    pendingSeek.current = at > 0 ? at : null;
    setMode('direct');
    const url = streamUrl(fileIdRef.current);
    if (!url) {
      setWaiting(false);
      setError('Aucun lien Freebox pour ce fichier : relancez « npm run deploy » à la maison.');
      return;
    }
    setError(null);
    setWaiting(true);
    setSrc(url);
  }, []);

  const startTranscode = useCallback((at: number) => {
    modeRef.current = 'transcode';
    offsetRef.current = at;
    timeRef.current = at;
    pendingSeek.current = null;
    setMode('transcode');
    setError(null);
    setWaiting(true);
    setTime(at);
    setSrc(transcodeUrl(fileIdRef.current, at));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fileIdRef.current = fileId;
    timeRef.current = 0;
    durationRef.current = 0;
    setInfo(null);
    setNoAudio(false);
    setForceAac(false);
    setCreditsMode(false);
    audioCheck.current = { start: null, done: false };
    setMode(null);
    setSrc('');
    setError(null);
    setWaiting(true);
    setTime(0);
    setBuffered(0);
    setDuration(0);

    const saved = getProgressMap()[fileId];
    const startAt = saved && saved.duration > 0 && saved.position > 15 && saved.position / saved.duration < 0.95 ? saved.position : 0;

    api
      .streamInfo(fileId)
      .catch(() => EMPTY_INFO)
      .then((result) => {
        if (cancelled) return;
        setInfo(result);
        if (result.duration) {
          durationRef.current = result.duration;
          setDuration(result.duration);
        }
        if (result.needsTranscode && result.transcodeAvailable) startTranscode(startAt);
        else startDirect(startAt);
      });

    return () => {
      cancelled = true;
      persist(true);
    };
  }, [fileId, persist, startDirect, startTranscode]);

  const poke = useCallback(() => {
    setUiVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setUiVisible(false);
    }, 3000);
  }, []);

  useEffect(() => {
    poke();
    return () => window.clearTimeout(hideTimer.current);
  }, [poke]);

  useEffect(() => {
    const unlock = lockScroll();
    const onFullscreen = (): void => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      unlock();
      document.removeEventListener('fullscreenchange', onFullscreen);
      // Plein écran du lecteur (ordinateur) : on le quitte. Celui de la page (mobile) est géré à la fermeture,
      // pour rester en plein écran quand on passe d'un film de la saga à l'autre.
      if (document.fullscreenElement === rootRef.current) void document.exitFullscreen().catch(() => undefined);
      notifyStorage();
    };
  }, []);

  const seek = useCallback(
    (target: number) => {
      const total = durationRef.current;
      const clamped = Math.max(0, total > 0 ? Math.min(target, total - 1) : target);
      const video = videoRef.current;
      if (modeRef.current === 'transcode') {
        const local = clamped - offsetRef.current;
        if (video && local >= 0 && isBuffered(video, local)) video.currentTime = local;
        else startTranscode(clamped);
      } else if (video) {
        video.currentTime = clamped;
      }
      timeRef.current = clamped;
      setTime(clamped);
    },
    [startTranscode]
  );

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }, []);

  const applyVolume = useCallback((value: number, mute: boolean) => {
    const next = Math.min(1, Math.max(0, value));
    setVolume(next);
    setMuted(mute);
    if (videoRef.current) {
      videoRef.current.volume = next;
      videoRef.current.muted = mute || Boolean(audioRef.current);
    }
    if (audioRef.current) {
      audioRef.current.volume = next;
      audioRef.current.muted = mute;
    }
    setPrefs({ volume: next, muted: mute });
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void rootRef.current?.requestFullscreen().catch(() => undefined);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    const video = videoRef.current;
    if (!sideAudio || !audio || !video) return;
    video.muted = true;
    audio.currentTime = video.currentTime;
    audio.volume = volume;
    audio.muted = muted;
    if (!video.paused) void audio.play().catch(() => undefined);
  }, [sideAudio]); // eslint-disable-line react-hooks/exhaustive-deps

  const goNext = useCallback(() => {
    if (!nextFile) return;
    persist(false);
    onChangeFile(nextFile.id);
  }, [nextFile, onChangeFile, persist]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'SELECT') return;
      switch (event.key) {
        case ' ':
        case 'k':
        case 'K':
          event.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          seek(timeRef.current - 10);
          break;
        case 'ArrowRight':
          event.preventDefault();
          seek(timeRef.current + 10);
          break;
        case 'ArrowUp':
          event.preventDefault();
          applyVolume(volume + 0.1, false);
          break;
        case 'ArrowDown':
          event.preventDefault();
          applyVolume(volume - 0.1, muted);
          break;
        case 'm':
        case 'M':
          applyVolume(volume, !muted);
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
        case 'n':
        case 'N':
          goNext();
          break;
        case 'Escape':
          if (!document.fullscreenElement) onClose();
          break;
        default:
          return;
      }
      poke();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applyVolume, goNext, muted, onClose, poke, seek, toggleFullscreen, togglePlay, volume]);

  const onLoadedMetadata = (): void => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted || Boolean(sideAudio);
    if (modeRef.current === 'direct') {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        durationRef.current = video.duration;
        setDuration(video.duration);
      }
      if (video.videoWidth === 0 && video.videoHeight === 0 && info?.transcodeAvailable) {
        startTranscode(pendingSeek.current ?? 0);
        return;
      }
      if (pendingSeek.current !== null) {
        video.currentTime = pendingSeek.current;
        timeRef.current = pendingSeek.current;
        pendingSeek.current = null;
      }
    }
    void video.play().catch(() => setPlaying(false));
  };

  const onTimeUpdate = (): void => {
    const video = videoRef.current;
    if (!video) return;
    const absolute = (modeRef.current === 'transcode' ? offsetRef.current : 0) + video.currentTime;
    timeRef.current = absolute;
    if (!dragging) setTime(absolute);
    const check = audioCheck.current;
    if (!check.done && modeRef.current === 'direct' && !video.paused) {
      if (check.start === null) check.start = video.currentTime;
      else if (video.currentTime - check.start > 2.5) {
        check.done = true;
        if (!sideAudio && hasNoAudio(video)) setNoAudio(true);
      }
    }
    const audio = audioRef.current;
    if (audio && !video.paused && Math.abs(audio.currentTime - video.currentTime) > 0.3) audio.currentTime = video.currentTime;
    if (Date.now() - lastSave.current > 5000) {
      lastSave.current = Date.now();
      persist(false);
    }
  };

  const onProgress = (): void => {
    const video = videoRef.current;
    if (!video || video.buffered.length === 0) return;
    const offset = modeRef.current === 'transcode' ? offsetRef.current : 0;
    setBuffered(offset + video.buffered.end(video.buffered.length - 1));
  };

  const onError = (): void => {
    if (!src) return;
    if (modeRef.current === 'direct' && info?.transcodeAvailable) {
      startTranscode(timeRef.current);
      return;
    }
    setWaiting(false);
    setError(
      modeRef.current === 'transcode'
        ? 'Le transcodage FFmpeg a échoué pour ce fichier.'
        : __VITRINE__
          ? 'Lecture impossible : le disque de la Freebox est peut-être déconnecté, ou ce format n’est pas lisible dans le navigateur. Réessayez plus tard ou utilisez « Télécharger ».'
          : 'Format non lisible par le navigateur. Installez FFmpeg et activez ENABLE_TRANSCODE côté serveur.'
    );
  };

  const onEnded = (): void => {
    persist(false, true);
    if (nextFile) onChangeFile(nextFile.id);
    else onClose();
  };

  const pctFromPointer = (clientX: number): number => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const onBarDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (duration <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    setTime(pctFromPointer(event.clientX) * duration);
  };

  const onBarMove = (event: PointerEvent<HTMLDivElement>): void => {
    const pct = pctFromPointer(event.clientX);
    setHoverPct(pct);
    if (dragging) setTime(pct * duration);
  };

  const onBarUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return;
    setDragging(false);
    seek(pctFromPointer(event.clientX) * duration);
  };

  const showUi = uiVisible || !playing || Boolean(error) || listOpen;
  const pct = (value: number): string => `${duration > 0 ? Math.min(100, (value / duration) * 100) : 0}%`;
  // Carte « Épisode suivant » : 25 dernières secondes (générique), décompte de 10 s qui se met en pause avec la vidéo.
  const nearEnd = Boolean(nextFile) && !creditsMode && duration > 60 && duration - time < 25;
  const nextMeta =
    nextFile && nextFile.season !== null && nextFile.episode !== null ? item.seasons[String(nextFile.season)]?.episodes[String(nextFile.episode)] : undefined;

  return (
    <motion.div
      ref={rootRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onMouseMove={poke}
      onTouchStart={poke}
      className={`fixed inset-0 z-[100] bg-black ${showUi ? '' : 'cursor-none'}`}
    >
      <video
        ref={videoRef}
        src={src || undefined}
        autoPlay
        playsInline
        preload="auto"
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onProgress={onProgress}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          persist(false);
          audioRef.current?.pause();
        }}
        onSeeking={() => {
          if (audioRef.current && videoRef.current) audioRef.current.currentTime = videoRef.current.currentTime;
        }}
        onRateChange={() => {
          if (audioRef.current && videoRef.current) audioRef.current.playbackRate = videoRef.current.playbackRate;
        }}
        onWaiting={() => {
          setWaiting(true);
          audioRef.current?.pause();
        }}
        onPlaying={() => {
          setWaiting(false);
          const audio = audioRef.current;
          const video = videoRef.current;
          if (audio && video) {
            audio.currentTime = video.currentTime;
            audio.volume = volume;
            audio.muted = muted;
            void audio.play().catch(() => undefined);
          }
        }}
        onCanPlay={() => setWaiting(false)}
        onEnded={onEnded}
        onError={onError}
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        className="h-full w-full bg-black object-contain"
      />
      {sideAudio && <audio key={sideAudio} ref={audioRef} src={sideAudio} preload="auto" className="hidden" />}

      {waiting && !error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <LoaderCircle className="h-16 w-16 animate-spin text-ap-red" />
        </div>
      )}

      {noAudio && !error && (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute left-1/2 top-20 z-20 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 rounded-xl bg-black/80 p-4 shadow-2xl ring-1 ring-white/15 backdrop-blur-xl"
        >
          <p className="text-sm font-semibold text-white">Pas de son dans le navigateur</p>
          <p className="mt-1 text-xs text-neutral-300">
            {aacUrl
              ? 'Le son d’origine est en Dolby, que cet appareil ne lit pas ici. Choisissez :'
              : `Le son de ce fichier est en Dolby (AC3 / E-AC3), que le navigateur ne sait pas lire. VLC le lit parfaitement. ${vlcHint()}`}
          </p>
          {aacUrl ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setForceAac(true);
                  setNoAudio(false);
                }}
                className="rounded-xl bg-white px-4 py-2.5 text-left text-black transition hover:bg-white/85"
              >
                <span className="block text-sm font-semibold">Son normal ici</span>
                <span className="block text-xs text-neutral-600">AAC stéréo, sans quitter le site</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  videoRef.current?.pause();
                  openInVlc(src, `${item.title}${subtitle ? ` - ${subtitle}` : ''}`);
                }}
                className="rounded-xl bg-[#ff8800] px-4 py-2.5 text-left text-black transition hover:bg-[#ffa033]"
              >
                <span className="block text-sm font-semibold">VLC · Dolby 5.1</span>
                <span className="block text-xs text-black/70">Son d’origine, application VLC</span>
              </button>
            </div>
          ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                videoRef.current?.pause();
                openInVlc(src, `${item.title}${subtitle ? ` - ${subtitle}` : ''}`);
              }}
              className="rounded-full bg-[#ff8800] px-4 py-1.5 text-sm font-semibold text-black transition hover:bg-[#ffa033]"
            >
              Ouvrir dans VLC
            </button>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(src).catch(() => undefined)}
              className="rounded-full bg-white/15 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-white/25"
            >
              Copier le lien
            </button>
            <button
              type="button"
              onClick={() => setNoAudio(false)}
              className="ml-auto rounded-full px-3 py-1.5 text-sm text-neutral-300 transition hover:text-white"
            >
              Continuer sans son
            </button>
          </div>
          )}
        </motion.div>
      )}

      {error && (
        <div className="absolute inset-0 grid place-items-center bg-black/80 p-6">
          <div className="max-w-md text-center">
            <p className="text-lg text-white">{error}</p>
            {info?.reason && <p className="mt-2 text-sm text-neutral-400">{info.reason}</p>}
            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                onClick={() => (mode === 'transcode' ? startTranscode(timeRef.current) : startDirect(timeRef.current))}
                className="rounded bg-white px-5 py-2 font-semibold text-black hover:bg-white/80"
              >
                Réessayer
              </button>
              <button type="button" onClick={onClose} className="rounded bg-neutral-700 px-5 py-2 font-semibold text-white hover:bg-neutral-600">
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ${showUi ? 'opacity-100' : 'opacity-0'}`}
      >
        <div className="pointer-events-auto absolute inset-x-0 top-0 flex items-center gap-4 bg-linear-to-b from-black/80 to-transparent px-4 pb-16 pt-4 md:px-8">
          <button type="button" onClick={onClose} aria-label="Retour" className="rounded-full p-2 transition hover:bg-white/10">
            <ArrowLeft className="h-8 w-8" />
          </button>
          <div className="min-w-0">
            <p className="truncate font-display text-2xl leading-none text-white md:text-3xl">{item.title}</p>
            {subtitle && <p className="truncate text-sm text-neutral-300">{subtitle}</p>}
          </div>
          {mode === 'transcode' && info?.reason && (
            <span className="ml-auto hidden rounded bg-white/10 px-2 py-1 text-xs text-neutral-300 md:block">FFmpeg · {info.reason}</span>
          )}
        </div>

        <div className="pointer-events-auto absolute inset-x-0 bottom-0 bg-linear-to-t from-black/90 via-black/50 to-transparent px-[max(1rem,env(safe-area-inset-left))] pb-[max(1rem,env(safe-area-inset-bottom))] pt-20 md:px-8">
          <div
            ref={barRef}
            onPointerDown={onBarDown}
            onPointerMove={onBarMove}
            onPointerUp={onBarUp}
            onPointerLeave={() => setHoverPct(null)}
            className="group/bar relative flex h-6 cursor-pointer touch-none items-center"
          >
            <div className="relative h-1 w-full rounded-full bg-white/25 transition-all group-hover/bar:h-1.5">
              <div className="absolute inset-y-0 left-0 rounded-full bg-white/35" style={{ width: pct(buffered) }} />
              <div className="absolute inset-y-0 left-0 rounded-full bg-ap-red" style={{ width: pct(time) }} />
              <div
                className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ap-red shadow transition-transform ${
                  dragging ? 'scale-100' : 'scale-0 group-hover/bar:scale-100'
                }`}
                style={{ left: pct(time) }}
              />
            </div>
            {hoverPct !== null && duration > 0 && (
              <div
                className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded bg-black/85 px-2 py-1 text-xs text-white"
                style={{ left: `${hoverPct * 100}%` }}
              >
                {formatClock(hoverPct * duration)}
              </div>
            )}
          </div>

          <div className="mt-2 flex items-center gap-1 sm:gap-2 md:gap-4">
            <button type="button" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Lecture'} className="p-1.5 transition hover:scale-110">
              {playing ? <Pause className="h-8 w-8 fill-current" /> : <Play className="h-8 w-8 fill-current" />}
            </button>
            <button type="button" onClick={() => seek(timeRef.current - 10)} aria-label="Reculer de 10 secondes" className="p-1.5 transition hover:scale-110">
              <RotateCcw className="h-7 w-7" />
            </button>
            <button type="button" onClick={() => seek(timeRef.current + 10)} aria-label="Avancer de 10 secondes" className="p-1.5 transition hover:scale-110">
              <RotateCw className="h-7 w-7" />
            </button>
            <div className="group/vol hidden items-center md:flex">
              <button
                type="button"
                onClick={() => applyVolume(volume, !muted)}
                aria-label={muted ? 'Activer le son' : 'Couper le son'}
                className="p-1.5 transition hover:scale-110"
              >
                {muted || volume === 0 ? <VolumeX className="h-7 w-7" /> : <Volume2 className="h-7 w-7" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(event) => applyVolume(Number(event.target.value), false)}
                aria-label="Volume"
                className="ap-range w-0 opacity-0 transition-all duration-300 group-hover/vol:w-24 group-hover/vol:opacity-100"
              />
            </div>
            <span className="ml-1 whitespace-nowrap text-xs tabular-nums text-neutral-200 sm:text-sm">
              {formatClock(time)} / {formatClock(duration)}
            </span>

            <div className="ml-auto flex items-center gap-2 md:gap-4">
              {info?.transcodeAvailable && (
                <button
                  type="button"
                  onClick={() => (mode === 'transcode' ? startDirect(timeRef.current) : startTranscode(timeRef.current))}
                  title="Basculer entre lecture directe et transcodage FFmpeg (son AC3/DTS, HEVC…)"
                  className={`hidden rounded border px-2 py-1 text-xs font-semibold transition md:inline-block ${
                    mode === 'transcode' ? 'border-ap-red bg-ap-red/20 text-white' : 'border-white/40 text-neutral-200 hover:border-white'
                  }`}
                >
                  {mode === 'transcode' ? 'FFmpeg' : 'Direct'}
                </button>
              )}
              {(item.type === 'tv' ? item.files.length > 1 : saga.length > 1) && (
                <button
                  type="button"
                  onClick={() => {
                    setListSeason(file?.season ?? null);
                    setListOpen((open) => !open);
                  }}
                  aria-expanded={listOpen}
                  className="inline-flex items-center gap-1.5 rounded p-1.5 text-sm transition hover:scale-105"
                >
                  <ListVideo className="h-7 w-7" />
                  <span className="hidden md:inline">{item.type === 'tv' ? 'Épisodes' : 'Saga'}</span>
                </button>
              )}
              {nextFile && (
                <button type="button" onClick={goNext} className="inline-flex items-center gap-1.5 p-1.5 text-sm transition hover:scale-105">
                  <SkipForward className="h-7 w-7" />
                  <span className="hidden md:inline">Épisode suivant</span>
                </button>
              )}
              <button
                type="button"
                onClick={toggleFullscreen}
                aria-label={fullscreen ? 'Quitter le plein écran' : 'Plein écran'}
                className="hidden p-1.5 transition hover:scale-110 md:block"
              >
                {fullscreen ? <Minimize className="h-7 w-7" /> : <Maximize className="h-7 w-7" />}
              </button>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {listOpen && (
              <motion.div
                key="episodes"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <EpisodeStrip
                  item={item}
                  fileId={fileId}
                  saga={saga}
                  season={listSeason}
                  onSeason={setListSeason}
                  onPickFile={(id) => {
                    setListOpen(false);
                    if (id !== fileId) {
                      persist(false);
                      onChangeFile(id);
                    }
                  }}
                  onPickItem={(other) => {
                    setListOpen(false);
                    if (other.id !== item.id) {
                      persist(false);
                      onPlayItem?.(other);
                    }
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {nearEnd && nextFile && (
        <motion.div
          key={nextFile.id}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="absolute bottom-28 right-4 z-10 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-lg bg-black/85 shadow-2xl ring-1 ring-white/15 backdrop-blur-md md:right-10"
        >
          <div className="flex gap-3 p-3">
            <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded bg-neutral-800">
              {(artUrl(nextMeta?.still) ?? artUrl(item.backdrop)) && (
                <img src={artUrl(nextMeta?.still) ?? artUrl(item.backdrop) ?? undefined} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-neutral-400">Épisode suivant</p>
              <p className="mt-0.5 text-sm font-semibold text-white">{episodeLabel(nextFile)}</p>
              {nextMeta?.name && <p className="line-clamp-2 text-sm text-neutral-300">{nextMeta.name}</p>}
            </div>
          </div>
          <div className="flex gap-2 px-3 pb-3">
            <button
              type="button"
              onClick={goNext}
              className="relative flex-1 overflow-hidden rounded bg-white/25 py-2.5 text-sm font-semibold text-black"
            >
              {/* Barre qui se remplit en 10 s puis lance l'épisode ; suit la pause de la vidéo. */}
              <span
                aria-hidden="true"
                onAnimationEnd={goNext}
                className="ap-next-fill absolute inset-y-0 left-0 bg-white"
                style={{ animationPlayState: playing ? 'running' : 'paused' }}
              />
              <span className="relative inline-flex items-center gap-2">
                <Play className="h-4 w-4 fill-current" /> Épisode suivant
              </span>
            </button>
            <button
              type="button"
              onClick={() => setCreditsMode(true)}
              className="rounded bg-white/10 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20"
            >
              Voir le générique
            </button>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

/** Bande d'épisodes (saison au choix) ou des films de la saga, sous les commandes du lecteur. */
function EpisodeStrip({
  item,
  fileId,
  saga,
  season,
  onSeason,
  onPickFile,
  onPickItem
}: {
  item: MediaItem;
  fileId: string;
  saga: MediaItem[];
  season: number | null;
  onSeason: (season: number | null) => void;
  onPickFile: (fileId: string) => void;
  onPickItem: (item: MediaItem) => void;
}) {
  const progress = getProgressMap();
  const ratio = (id: string): number => {
    const entry = progress[id];
    return entry && entry.duration > 0 ? Math.min(1, entry.position / entry.duration) : 0;
  };
  const seasons = [...new Set(item.files.map((file) => file.season ?? 0))].sort((a, b) => a - b);
  const shownSeason = season ?? seasons[0] ?? 0;

  const cards =
    item.type === 'tv'
      ? item.files
          .filter((file) => (file.season ?? 0) === shownSeason)
          .map((file) => {
            const meta = file.season !== null && file.episode !== null ? item.seasons[String(file.season)]?.episodes[String(file.episode)] : undefined;
            return {
              key: file.id,
              current: file.id === fileId,
              art: artUrl(meta?.still) ?? artUrl(item.backdrop),
              label: file.episode !== null ? `Épisode ${file.episode}` : file.name,
              title: meta?.name ?? '',
              progress: ratio(file.id),
              pick: () => onPickFile(file.id)
            };
          })
      : saga.map((film) => ({
          key: film.id,
          current: film.id === item.id,
          art: artUrl(film.backdrop) ?? artUrl(film.poster),
          label: film.year ? String(film.year) : '',
          title: film.title,
          progress: Math.max(0, ...film.files.map((file) => ratio(file.id))),
          pick: () => onPickItem(film)
        }));

  return (
    <div className="pt-4">
      <div className="mb-3 flex items-center gap-3">
        <p className="shrink-0 text-base font-semibold text-white md:text-lg">
          {item.type === 'tv' ? 'Épisodes' : `Saga · ${item.collections?.[0]?.split(' · ').pop() ?? ''}`}
        </p>
        {item.type === 'tv' && seasons.length > 1 && (
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
            {seasons.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onSeason(value)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition ${
                  value === shownSeason ? 'bg-white text-black' : 'bg-white/10 text-neutral-200 hover:bg-white/20'
                }`}
              >
                Saison {value}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={card.pick}
            className={`group/ep w-44 shrink-0 text-left md:w-56 ${card.current ? '' : 'opacity-80 hover:opacity-100'}`}
          >
            <span
              className={`relative block aspect-video overflow-hidden rounded-md bg-neutral-800 ring-2 transition ${
                card.current ? 'ring-ap-red' : 'ring-transparent group-hover/ep:ring-white/60'
              }`}
            >
              {card.art && <img src={card.art} alt="" loading="lazy" className="h-full w-full object-cover" />}
              {card.current ? (
                <span className="absolute left-1.5 top-1.5 rounded bg-ap-red px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">En cours</span>
              ) : (
                <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition group-hover/ep:opacity-100">
                  <Play className="h-8 w-8 fill-white text-white" />
                </span>
              )}
              {card.progress > 0.01 && (
                <span className="absolute inset-x-1.5 bottom-1.5 h-1 overflow-hidden rounded bg-white/25">
                  <span className="block h-full bg-ap-red" style={{ width: `${Math.round(card.progress * 100)}%` }} />
                </span>
              )}
            </span>
            <span className="mt-1.5 block text-xs text-neutral-400">{card.label}</span>
            <span className="line-clamp-1 block text-sm font-medium text-white">{card.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
