/**
 * Agent de synchronisation (npm run sync-agent) — tourne en fond sur le PC, lancé à l'ouverture de session.
 *
 * Toutes les 30 s, il regarde si une synchro a été demandée depuis la page Paramètres du site
 * (/__api/sync, accessible sans PIN depuis la maison). Si oui : lance deploy.ps1 complet
 * (scan + liens + pistes son + publication) et publie l'avancement dans sync-status.json.
 * Toutes les 5 min, il signale aussi qu'il est en ligne (le site sait si le PC est allumé).
 */
import { execFile, spawn } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { config, PROJECT_ROOT } from './config.js';
import { uploadSiteFile } from './lib/site-ftp.js';
import { Scanner } from './lib/scanner.js';
import { CatalogStore } from './lib/store.js';
import { errorMessage, sleep } from './lib/utils.js';

const run = promisify(execFile);
const POLL_MS = 30_000;
const HEARTBEAT_MS = 5 * 60_000;
const site = config.siteUrl.replace(/\/+$/, '');

type SyncState = 'idle' | 'running' | 'done' | 'failed';
interface CheckResult {
  checkedAt: string;
  state: 'running' | 'done' | 'failed';
  added: string[];
  removed: string[];
  error?: string;
}
interface SyncStatus {
  state: SyncState;
  check?: CheckResult;
  agentSeenAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  step: string;
  lines: string[];
}

const status: SyncStatus = { state: 'idle', agentSeenAt: new Date().toISOString(), startedAt: null, finishedAt: null, step: '', lines: [] };
let lastPush = 0;
let pushing = Promise.resolve();

const log = (message: string): void => console.log(`[sync] ${new Date().toLocaleTimeString('fr-FR')} ${message}`);

function push(force = false): void {
  if (!force && Date.now() - lastPush < 5000) return;
  lastPush = Date.now();
  status.agentSeenAt = new Date().toISOString();
  const body = JSON.stringify(status);
  pushing = pushing.then(() => uploadSiteFile('sync-status.json', body).catch((error) => log(`Statut non envoyé : ${errorMessage(error)}`)));
}

async function api(method: 'GET' | 'POST', body?: unknown): Promise<{ requestedAt?: string | null; kind?: string }> {
  const response = await fetch(`${site}/__api/sync`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as { requestedAt?: string | null; kind?: string };
}

/** Une conversion audio lancée à la main tourne-t-elle déjà ? (on ne la double pas) */
async function audioRunning(): Promise<boolean> {
  try {
    const { stdout } = await run('powershell.exe', [
      '-NoProfile',
      '-Command',
      "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'audio-cli' }).Count"
    ]);
    return Number(stdout.trim()) > 0;
  } catch {
    return false;
  }
}

const clean = (line: string): string => line.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '').trim();

async function syncNow(): Promise<void> {
  const skipAudio = await audioRunning();
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(PROJECT_ROOT, 'deploy.ps1')];
  if (skipAudio) args.push('-SansAudio');
  Object.assign(status, { state: 'running', startedAt: new Date().toISOString(), finishedAt: null, step: 'Démarrage', lines: [] });
  if (skipAudio) status.lines.push('Conversion du son déjà en cours : étape audio ignorée.');
  push(true);
  log(`Synchronisation lancée${skipAudio ? ' (sans étape audio)' : ''}.`);

  const code = await new Promise<number>((resolve) => {
    const child = spawn('powershell.exe', args, { cwd: PROJECT_ROOT, windowsHide: true });
    const onData = (chunk: Buffer): void => {
      for (const raw of chunk.toString().split('\n')) {
        const line = clean(raw);
        if (!line || /: \d+\/\d+$/.test(line)) continue;
        if (line.startsWith('>>')) status.step = line.replace(/^>>\s*/, '');
        else if (line.startsWith('[deploy]') || line.startsWith('[audio]') || /^(OK|ECHEC)/.test(line)) {
          status.lines = [...status.lines, line.replace(/^\[(deploy|audio)\]\s*/, '')].slice(-8);
        }
      }
      push();
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (exit) => resolve(exit ?? 1));
    child.on('error', () => resolve(1));
  });

  Object.assign(status, { state: code === 0 ? 'done' : 'failed', finishedAt: new Date().toISOString(), step: code === 0 ? 'Terminé' : 'Échec' });
  // Après une synchro réussie, l'ancienne liste de nouveautés n'a plus lieu d'être.
  if (code === 0) delete status.check;
  push(true);
  await pushing;
  log(code === 0 ? 'Synchronisation terminée.' : `Synchronisation en échec (code ${code}).`);
}

/** Un seul agent à la fois (démarrage Windows + lancement manuel). */
function acquireLock(): boolean {
  const lock = path.join(config.dataDir, 'sync-agent.lock');
  try {
    const pid = Number(readFileSync(lock, 'utf8').trim());
    if (pid && pid !== process.pid) {
      process.kill(pid, 0);
      return false;
    }
  } catch {
    // pas de verrou, ou processus disparu
  }
  writeFileSync(lock, String(process.pid));
  process.once('exit', () => rmSync(lock, { force: true }));
  return true;
}

/** « Vérifier les nouveautés » : liste le disque (API Freebox, ~1 s) et compare au catalogue, sans rien publier. */
async function checkNow(): Promise<void> {
  status.check = { checkedAt: new Date().toISOString(), state: 'running', added: [], removed: [] };
  push(true);
  log('Vérification des nouveautés…');
  try {
    const store = new CatalogStore(config.dataDir);
    await store.load();
    const known = new Set(Object.values(store.data.files).map((file) => file.relPath));
    const found = (await (new Scanner(store) as unknown as { walkFreebox: () => Promise<Array<{ relPath: string }>> }).walkFreebox()).map(
      (file) => file.relPath
    );
    const onDisk = new Set(found);
    const name = (relPath: string): string => relPath.split('/').pop() ?? relPath;
    status.check = {
      checkedAt: new Date().toISOString(),
      state: 'done',
      added: found.filter((relPath) => !known.has(relPath)).map(name).sort((a, b) => a.localeCompare(b, 'fr')),
      removed: [...known].filter((relPath) => !onDisk.has(relPath)).map(name).sort((a, b) => a.localeCompare(b, 'fr'))
    };
    log(`Nouveautés : ${status.check.added.length} ajout(s), ${status.check.removed.length} retrait(s).`);
  } catch (error) {
    status.check = { checkedAt: new Date().toISOString(), state: 'failed', added: [], removed: [], error: errorMessage(error) };
    log(`Vérification impossible : ${errorMessage(error)}`);
  }
  push(true);
  await pushing;
}

async function main(): Promise<void> {
  if (!site) throw new Error('SITE_URL manquant dans .env');
  if (!acquireLock()) {
    log('Un agent tourne déjà : arrêt.');
    return;
  }
  log(`Agent démarré : surveillance de ${site}/__api/sync toutes les ${POLL_MS / 1000} s.`);
  push(true);
  let lastHeartbeat = Date.now();
  for (;;) {
    try {
      const { requestedAt, kind } = await api('GET');
      if (requestedAt) {
        await api('POST', { action: 'clear' });
        if (kind === 'check') await checkNow();
        else await syncNow();
        lastHeartbeat = Date.now();
      } else if (Date.now() - lastHeartbeat > HEARTBEAT_MS) {
        push(true);
        lastHeartbeat = Date.now();
      }
    } catch (error) {
      log(`Site injoignable : ${errorMessage(error)}`);
    }
    await sleep(POLL_MS);
  }
}

main().catch((error) => {
  console.error(`[sync] ${errorMessage(error)}`);
  process.exit(1);
});
