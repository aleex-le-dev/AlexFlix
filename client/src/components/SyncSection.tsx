import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, FileSearch, LoaderCircle, RefreshCw } from 'lucide-react';

/** Avancement publié par l'agent du PC (server/src/sync-agent.ts) dans sync-status.json. */
interface CheckResult {
  checkedAt: string;
  state: 'running' | 'done' | 'failed';
  added: string[];
  removed: string[];
  error?: string;
}

interface SyncStatus {
  state: 'idle' | 'running' | 'done' | 'failed';
  check?: CheckResult;
  agentSeenAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  step: string;
  lines: string[];
}

/** Le PC signale sa présence toutes les 5 min : au-delà de 7 min sans nouvelles, il est sans doute éteint. */
const OFFLINE_MS = 7 * 60 * 1000;

function ago(iso: string | null): string {
  if (!iso) return 'jamais';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `il y a ${seconds} s`;
  if (seconds < 3600) return `il y a ${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `il y a ${Math.round(seconds / 3600)} h`;
  return `il y a ${Math.round(seconds / 86400)} j`;
}

/**
 * Paramètres › Synchronisation : un bouton dépose une demande sur le site ; l'agent du PC (allumé)
 * la récupère sous 30 s et lance scan + liens + pistes son + publication.
 */
export function SyncSection() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [pending, setPending] = useState<'sync' | 'check' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [statusResponse, requestResponse] = await Promise.all([
        fetch(`/sync-status.json?t=${Date.now()}`, { cache: 'no-store', credentials: 'include' }),
        fetch('/__api/sync', { cache: 'no-store', credentials: 'include' })
      ]);
      if (statusResponse.ok) setStatus((await statusResponse.json()) as SyncStatus);
      if (requestResponse.ok) {
        const request = (await requestResponse.json()) as { requestedAt?: string | null; kind?: string };
        setPending(request.requestedAt ? (request.kind === 'check' ? 'check' : 'sync') : null);
      }
    } catch {
      // réessayé au prochain passage
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const request = async (action: 'request' | 'check'): Promise<void> => {
    setError(null);
    try {
      const response = await fetch('/__api/sync', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      if (!response.ok) throw new Error(`Erreur ${response.status}`);
      setPending(action === 'check' ? 'check' : 'sync');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Demande impossible');
    }
  };

  const online = Boolean(status && Date.now() - new Date(status.agentSeenAt).getTime() < OFFLINE_MS);
  const running = status?.state === 'running' && online;
  const checking = (status?.check?.state === 'running' && online) || pending === 'check';
  const busy = running || pending === 'sync';
  const check = status?.check;

  return (
    <section className="mt-4 rounded-xl bg-white/5 p-5 ring-1 ring-white/10">
      <div className="flex items-center gap-3">
        <RefreshCw className={`h-5 w-5 text-ap-red ${running ? 'animate-spin' : ''}`} />
        <h3 className="font-semibold text-white">Synchronisation de la bibliothèque</h3>
        <span
          className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            online ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/10 text-neutral-400'
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-neutral-400'}`} />
          {online ? 'PC allumé' : 'PC éteint'}
        </span>
      </div>
      <p className="mt-1 text-xs text-neutral-400">
        Nouveaux films sur la Freebox, fichiers renommés ou déplacés : le PC scanne le disque, crée les liens et le son, puis met le site à jour.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void request('check')}
          disabled={busy || checking || !online}
          className="inline-flex items-center gap-2 rounded-md bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {checking ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
          {checking ? 'Vérification…' : 'Vérifier les nouveautés'}
        </button>
        <button
          type="button"
          onClick={() => void request('request')}
          disabled={busy || !online}
          className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/85 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {running ? 'Synchronisation en cours…' : pending === 'sync' ? 'Demande envoyée, le PC démarre…' : 'Synchroniser maintenant'}
        </button>
      </div>

      {check && check.state !== 'running' && !checking && (
        <div className="mt-4 rounded-lg bg-black/30 p-3 text-sm">
          {check.state === 'failed' ? (
            <p className="text-amber-400">Vérification impossible : {check.error}</p>
          ) : check.added.length === 0 && check.removed.length === 0 ? (
            <p className="inline-flex items-center gap-1.5 text-emerald-400">
              <CheckCircle2 className="h-4 w-4" /> Le site est à jour ({ago(check.checkedAt)}).
            </p>
          ) : (
            <>
              <p className="font-semibold text-white">
                {check.added.length > 0 && `${check.added.length} nouveauté${check.added.length > 1 ? 's' : ''}`}
                {check.added.length > 0 && check.removed.length > 0 && ' · '}
                {check.removed.length > 0 && `${check.removed.length} retiré${check.removed.length > 1 ? 's' : ''}`}
                <span className="font-normal text-neutral-400"> · {ago(check.checkedAt)}</span>
              </p>
              <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs">
                {check.added.map((name) => (
                  <li key={`+${name}`} className="truncate text-emerald-300">+ {name}</li>
                ))}
                {check.removed.map((name) => (
                  <li key={`-${name}`} className="truncate text-neutral-400 line-through">− {name}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-neutral-300">Cliquez sur « Synchroniser maintenant » pour les mettre sur le site.</p>
            </>
          )}
        </div>
      )}
      {!online && <p className="mt-2 text-xs text-amber-400">Allumez le PC (l'agent démarre avec Windows) pour lancer une synchronisation.</p>}
      {error && <p className="mt-2 text-xs text-amber-400">{error}</p>}

      {status && (
        <div className="mt-4 space-y-1.5 text-sm">
          {running && (
            <p className="text-neutral-300">
              Étape : <span className="font-semibold text-white">{status.step}</span> · démarrée {ago(status.startedAt)}
            </p>
          )}
          {!running && status.state === 'done' && (
            <p className="inline-flex items-center gap-1.5 text-emerald-400">
              <CheckCircle2 className="h-4 w-4" /> Dernière synchronisation réussie {ago(status.finishedAt)}
            </p>
          )}
          {!running && status.state === 'failed' && (
            <p className="inline-flex items-center gap-1.5 text-amber-400">
              <CircleAlert className="h-4 w-4" /> Dernière synchronisation en échec {ago(status.finishedAt)}
            </p>
          )}
          {status.lines.length > 0 && (status.state !== 'idle' || running) && (
            <ul className="mt-2 space-y-0.5 rounded-lg bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-neutral-300">
              {status.lines.map((line, index) => (
                <li key={`${index}-${line}`} className="truncate">
                  {line}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
