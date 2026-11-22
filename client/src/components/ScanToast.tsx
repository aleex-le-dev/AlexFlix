import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { ScanStatus } from '../types';

const PHASES: Record<ScanStatus['phase'], string> = {
  idle: 'En attente',
  walking: 'Lecture du disque Freebox…',
  matching: 'Identification TMDB…',
  saving: 'Enregistrement du catalogue…',
  done: 'Bibliothèque à jour',
  error: 'Erreur de scan'
};

export function ScanToast({ scan }: { scan: ScanStatus | null }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!scan) return;
    if (scan.running) {
      setVisible(true);
      return;
    }
    if (scan.finishedAt && Date.now() - Date.parse(scan.finishedAt) < 15000) {
      setVisible(true);
      const timer = window.setTimeout(() => setVisible(false), 7000);
      return () => window.clearTimeout(timer);
    }
    setVisible(false);
  }, [scan?.running, scan?.finishedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const ratio = scan && scan.newFiles > 0 ? Math.min(1, scan.processed / scan.newFiles) : 0;

  return (
    <AnimatePresence>
      {visible && scan && (
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 30 }}
          className="fixed bottom-5 right-5 z-[60] w-80 rounded-lg border border-white/10 bg-black/85 p-4 text-sm shadow-2xl backdrop-blur-xl"
        >
          <div className="flex items-center gap-3">
            {scan.running ? (
              <LoaderCircle className="h-5 w-5 shrink-0 animate-spin text-ap-red" />
            ) : scan.phase === 'error' ? (
              <TriangleAlert className="h-5 w-5 shrink-0 text-amber-400" />
            ) : (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
            )}
            <div className="min-w-0">
              <p className="font-semibold text-white">{PHASES[scan.phase]}</p>
              <p className="text-xs text-neutral-400">
                {scan.running
                  ? `${scan.processed}/${scan.newFiles} nouveaux · ${scan.filesFound} fichiers`
                  : scan.phase === 'error'
                    ? (scan.lastError ?? 'Erreur inconnue')
                    : `${scan.itemsTotal} titres · ${scan.newFiles} ajout(s) · ${scan.removedFiles} retrait(s)`}
              </p>
            </div>
          </div>
          {scan.running && scan.phase === 'matching' && (
            <div className="mt-3 h-1 overflow-hidden rounded bg-white/10">
              <div className="h-full bg-ap-red transition-all duration-500" style={{ width: `${Math.round(ratio * 100)}%` }} />
            </div>
          )}
          {!scan.running && scan.errors.length > 0 && scan.phase !== 'error' && (
            <p className="mt-2 text-xs text-amber-300/80">{scan.errors.length} avertissement(s) — voir les logs serveur.</p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
