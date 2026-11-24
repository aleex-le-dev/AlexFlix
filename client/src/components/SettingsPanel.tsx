import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AudioLines, CheckCircle2, CircleAlert, LoaderCircle, X } from 'lucide-react';
import { lockScroll } from '../lib/scrollLock';
import { SyncSection } from './SyncSection';

/** État envoyé par « npm run audio » (server/src/audio-cli.ts) à la racine du site. */
interface AudioStatus {
  updatedAt: string;
  startedAt: string;
  running: boolean;
  total: number;
  done: number;
  native: number;
  failed: number;
  remaining: number;
  etaMinutes: number | null;
  current: string[];
  published: number;
  publishedAt: string | null;
}

interface Props {
  onClose: () => void;
}

const STALE_MS = 10 * 60 * 1000;

function ago(iso: string | null): string {
  if (!iso) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `il y a ${seconds} s`;
  if (seconds < 3600) return `il y a ${Math.round(seconds / 60)} min`;
  return `il y a ${Math.round(seconds / 3600)} h`;
}

function duration(minutes: number | null): string {
  if (minutes === null) return 'calcul…';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

/** Page Paramètres : avancement de la conversion des sons Dolby en AAC (rafraîchie toutes les 10 s). */
export function SettingsPanel({ onClose }: Props) {
  const [status, setStatus] = useState<AudioStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => lockScroll(), []);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(`/audio-status.json?t=${Date.now()}`, { cache: 'no-store', credentials: 'include' });
        if (!response.ok) throw new Error(response.status === 404 ? 'Aucune conversion lancée pour l’instant.' : `Erreur ${response.status}`);
        const data = (await response.json()) as AudioStatus;
        if (!cancelled) {
          setStatus(data);
          setError(null);
        }
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : 'Statut indisponible.');
      }
    };
    void load();
    const poll = window.setInterval(() => void load(), 10000);
    const clock = window.setInterval(() => setTick((value) => value + 1), 1000);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearInterval(clock);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const ready = status ? status.done + status.native : 0;
  const pct = status && status.total > 0 ? Math.round((ready / status.total) * 100) : 0;
  const stale = status?.running && Date.now() - new Date(status.updatedAt).getTime() > STALE_MS;
  const state = !status ? null : stale ? 'stale' : status.running ? 'running' : status.remaining === 0 ? 'finished' : 'stopped';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Paramètres"
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-[#181818] p-6 shadow-2xl ring-1 ring-white/10 md:p-8"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-white">Paramètres</h2>
          <button type="button" onClick={onClose} aria-label="Fermer" className="grid h-9 w-9 place-items-center rounded-full bg-white/10 hover:bg-white/20">
            <X className="h-5 w-5" />
          </button>
        </div>

        <SyncSection />

        <section className="mt-4 rounded-xl bg-white/5 p-5 ring-1 ring-white/10">
          <div className="flex items-center gap-3">
            <AudioLines className="h-5 w-5 text-ap-red" />
            <h3 className="font-semibold text-white">Son des films (Dolby → AAC)</h3>
            {state === 'running' && (
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-ap-red/15 px-2.5 py-0.5 text-xs font-semibold text-ap-red">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> En cours
              </span>
            )}
            {state === 'finished' && (
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" /> Terminé
              </span>
            )}
            {(state === 'stale' || state === 'stopped') && (
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-400">
                <CircleAlert className="h-3.5 w-3.5" /> {state === 'stale' ? 'Interrompu ?' : 'En pause'}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-neutral-400">
            Les navigateurs ne lisent pas le son Dolby des MKV : le PC crée une piste AAC pour chaque film. Fichiers d’origine inchangés.
          </p>

          {error && !status && <p className="mt-5 text-sm text-neutral-300">{error}</p>}

          {status && (
            <>
              <div className="mt-5 flex items-baseline justify-between">
                <span className="text-3xl font-bold tabular-nums text-white">{pct} %</span>
                <span className="text-sm tabular-nums text-neutral-300">
                  {ready} / {status.total} vidéos avec son
                </span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/10">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-ap-red to-[#ff5a63]"
                  initial={false}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6 }}
                />
              </div>

              <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                {[
                  ['Converties', status.done],
                  ['Déjà OK', status.native],
                  ['Restantes', status.remaining],
                  ['Échecs', status.failed]
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-black/30 px-3 py-2">
                    <dt className="text-[11px] uppercase tracking-wider text-neutral-400">{label}</dt>
                    <dd className={`text-lg font-semibold tabular-nums ${label === 'Échecs' && Number(value) > 0 ? 'text-amber-400' : 'text-white'}`}>{value}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-5 space-y-1.5 text-sm text-neutral-300">
                {state === 'running' && (
                  <p>
                    Temps restant estimé : <span className="font-semibold text-white">{duration(status.etaMinutes)}</span>
                  </p>
                )}
                <p>
                  Sons disponibles sur le site : <span className="font-semibold text-white">{status.published}</span>
                  <span className="text-neutral-400"> · mis à jour {ago(status.publishedAt)} (tous les 25 films)</span>
                </p>
                <p className="text-neutral-400">Dernière nouvelle du PC : {ago(status.updatedAt)}</p>
                {state === 'stale' && (
                  <p className="text-amber-400">Plus de nouvelles depuis 10 min : le PC est peut-être éteint. Relancez « npm run audio » ou deploy.bat.</p>
                )}
              </div>

              {status.current.length > 0 && state === 'running' && (
                <div className="mt-5">
                  <p className="text-[11px] uppercase tracking-wider text-neutral-400">En cours de conversion</p>
                  <ul className="mt-2 space-y-1.5">
                    {status.current.map((name) => (
                      <li key={name} className="flex items-center gap-2 truncate text-sm text-neutral-200">
                        <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-neutral-400" />
                        <span className="truncate">{name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      </motion.div>
    </motion.div>
  );
}
