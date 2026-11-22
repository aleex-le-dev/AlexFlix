import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAmbient } from '../lib/ambient';

/** Bande-annonce plein écran en fond : démarre après un court délai, apparaît en fondu une fois lancée. */
function TrailerBackground({ videoKey }: { videoKey: string }) {
  const [start, setStart] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setStart(true), 600);
    return () => window.clearTimeout(timer);
  }, []);

  if (!start) return null;
  return (
    <div className={`absolute inset-0 transition-opacity duration-1000 ${visible ? 'opacity-100' : 'opacity-0'}`}>
      <iframe
        title="Bande-annonce"
        src={`https://www.youtube-nocookie.com/embed/${videoKey}?autoplay=1&mute=1&controls=0&loop=1&playlist=${videoKey}&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3&disablekb=1&start=4`}
        allow="autoplay; encrypted-media"
        tabIndex={-1}
        onLoad={() => window.setTimeout(() => setVisible(true), 1400)}
        className="absolute left-1/2 top-1/2 h-[max(56.25vw,100vh)] w-[max(100vw,177.78vh)] -translate-x-1/2 -translate-y-1/2 scale-[1.15] border-0"
      />
    </div>
  );
}

/** Fond de page : la pochette survolée très floutée, ou la bande-annonce pour les films de saga. */
export function AmbientBackdrop() {
  const ambient = useAmbient();
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <AnimatePresence>
        {ambient && (
          <motion.div
            key={`${ambient.image}|${ambient.trailer ?? ''}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="absolute inset-0"
          >
            <img src={ambient.image} alt="" draggable={false} className="h-full w-full scale-125 object-cover blur-[70px] saturate-150" />
            {ambient.trailer && <TrailerBackground videoKey={ambient.trailer} />}
            <div className={`absolute inset-0 ${ambient.trailer ? 'bg-gradient-to-b from-ap-bg/40 via-ap-bg/55 to-ap-bg/80' : 'bg-ap-bg/55'}`} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
