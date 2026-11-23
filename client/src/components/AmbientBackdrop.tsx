import { AnimatePresence, motion } from 'framer-motion';
import { useAmbient } from '../lib/ambient';

/** Fond de page : la pochette survolée, très floutée, en fondu enchaîné. */
export function AmbientBackdrop() {
  const url = useAmbient();
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <AnimatePresence>
        {url && (
          <motion.div
            key={url}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="absolute inset-0"
          >
            <img src={url} alt="" draggable={false} className="h-full w-full scale-125 object-cover blur-[70px] saturate-150" />
            <div className="absolute inset-0 bg-ap-bg/55" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
