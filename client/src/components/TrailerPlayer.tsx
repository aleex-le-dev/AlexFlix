import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle, Pause, Play, Volume2, VolumeX, X } from 'lucide-react';

interface Props {
  videoKey: string;
  title: string;
  onClose: () => void;
}

/** États du lecteur YouTube (API IFrame) : -1 non démarré, 0 fini, 1 lecture, 2 pause, 3 chargement, 5 prêt. */
type YtState = -1 | 0 | 1 | 2 | 3 | 5;

/**
 * Bande-annonce « maison » : la vidéo YouTube démarre seule, sans aucun élément YouTube visible
 * (titre, logo, suggestions, barre). Pilotée par l'API postMessage ; nos propres boutons :
 * lecture / pause (toucher n'importe où), son, fermer.
 *  - masquée sous un fond noir tant qu'elle ne tourne pas vraiment (écran de démarrage YouTube) ;
 *  - agrandie de 18 % pour couper les bandeaux ;
 *  - en pause, notre voile recouvre l'écran « Plus de vidéos » de YouTube.
 */
export function TrailerPlayer({ videoKey, title, onClose }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<YtState>(-1);
  const [visible, setVisible] = useState(false);
  const [muted, setMuted] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const command = useCallback((func: string, args: unknown[] = []) => {
    frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
  }, []);

  useEffect(() => {
    let revealTimer = 0;
    const onMessage = (event: MessageEvent): void => {
      if (typeof event.data !== 'string' || !/youtube(-nocookie)?\.com$/.test(new URL(event.origin).hostname)) return;
      let data: { event?: string; info?: { playerState?: YtState; muted?: boolean } };
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      const next = data.info?.playerState;
      if (typeof data.info?.muted === 'boolean') setMuted(data.info.muted);
      if (next === undefined) return;
      setState(next);
      if (next === 1) {
        // Le bandeau titre de YouTube s'efface ~2 s après le démarrage : on révèle ensuite.
        window.clearTimeout(revealTimer);
        revealTimer = window.setTimeout(() => setVisible(true), 1800);
      }
      if (next === 0) closeRef.current();
    };
    window.addEventListener('message', onMessage);

    // Abonnement aux événements du lecteur, puis repli en muet si le navigateur bloque le son au démarrage.
    const listen = window.setInterval(() => {
      frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: videoKey, channel: 'widget' }), '*');
    }, 400);
    const fallback = window.setTimeout(() => {
      setState((current) => {
        if (current !== 1) {
          command('mute');
          command('playVideo');
        }
        return current;
      });
    }, 2500);
    return () => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(listen);
      window.clearTimeout(fallback);
      window.clearTimeout(revealTimer);
    };
  }, [videoKey, command]);

  const playing = state === 1;
  const togglePlay = (): void => command(playing ? 'pauseVideo' : 'playVideo');
  const toggleMute = (): void => {
    command(muted ? 'unMute' : 'mute');
    setMuted(!muted);
  };

  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      <iframe
        ref={frameRef}
        title={`Bande-annonce ${title}`}
        src={`https://www.youtube-nocookie.com/embed/${videoKey}?autoplay=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&modestbranding=1&rel=0&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`}
        allow="autoplay; encrypted-media"
        tabIndex={-1}
        className={`pointer-events-none absolute left-1/2 top-1/2 aspect-video w-full -translate-x-1/2 -translate-y-1/2 scale-[1.18] border-0 transition-opacity duration-700 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Calque de contrôle : intercepte tous les touchers (rien de YouTube n'est cliquable). */}
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? 'Mettre en pause' : 'Lecture'}
        className={`absolute inset-0 grid place-items-center transition-colors duration-300 ${
          !visible || !playing ? 'bg-black/70' : 'bg-transparent'
        }`}
      >
        {!visible && state !== 2 ? (
          <LoaderCircle className="h-12 w-12 animate-spin text-white/80" />
        ) : (
          !playing && (
            <span className="grid h-16 w-16 place-items-center rounded-full bg-white/90 text-black shadow-2xl">
              <Play className="ml-1 h-8 w-8 fill-current" />
            </span>
          )
        )}
      </button>

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-linear-to-t from-black/80 to-transparent p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? 'Pause' : 'Lecture'}
          className="grid h-10 w-10 place-items-center rounded-full bg-black/60 text-white ring-1 ring-white/20"
        >
          {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
        </button>
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? 'Activer le son' : 'Couper le son'}
          className="grid h-10 w-10 place-items-center rounded-full bg-black/60 text-white ring-1 ring-white/20"
        >
          {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
        <span className="ml-1 truncate text-sm font-semibold text-white drop-shadow">{title}</span>
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label="Fermer la bande-annonce"
        className="absolute right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] grid h-10 w-10 place-items-center rounded-full bg-black/70 text-white ring-1 ring-white/20"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}
