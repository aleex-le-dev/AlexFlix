import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { lockScroll } from '../lib/scrollLock';
import { TrailerPlayer } from './TrailerPlayer';

interface Props {
  videoKey: string;
  title: string;
  onClose: () => void;
}

/**
 * Mobile : bande-annonce en plein écran dès le lancement.
 * Plein écran natif (demandé au toucher du bouton) + paysage quand le téléphone le permet (Android) ; sinon (iPhone) un calque noir
 * qui couvre tout l'écran, la vidéo centrée.
 */
export function TrailerFullscreen({ videoKey, title, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Fermeture lue via une ref : l'effet ne tourne qu'une fois (sinon il quitterait le plein écran à chaque rendu).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const unlock = lockScroll();
    const orientation = screen.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> };
    // Sortie du plein écran natif (bouton retour Android) = fermeture.
    const onFullscreen = (): void => {
      if (!document.fullscreenElement) closeRef.current();
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      unlock();
      document.removeEventListener('fullscreenchange', onFullscreen);
      orientation?.unlock?.();
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  return createPortal(
    <motion.div
      ref={ref}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[120] grid place-items-center bg-black"
      role="dialog"
      aria-label={`Bande-annonce ${title}`}
    >
      <div className="relative aspect-video max-h-full w-full">
        <TrailerPlayer videoKey={videoKey} title={title} onClose={onClose} />
      </div>
    </motion.div>,
    document.body
  );
}
