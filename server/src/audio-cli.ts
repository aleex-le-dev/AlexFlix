/**
 * Pistes audio séparées pour la vitrine (npm run audio).
 *
 * Les navigateurs ne décodent pas le Dolby (AC3 / E-AC3 / DTS / TrueHD) des MKV : l'image passe, le son est muet.
 * Pour chaque vidéo, on lit sa piste audio (française de préférence) depuis son lien Freebox, on la convertit en
 * AAC stéréo (.m4a, ~150 Mo pour 2 h), on l'envoie dans /<racine>/AlexFlix-audio/ sur la Freebox et on crée un
 * lien de partage. Le site lit alors la vidéo en muet + ce son synchronisé. Les fichiers originaux ne sont pas modifiés.
 *
 * Reprise automatique : data/audio-tracks.json garde l'état de chaque fichier ; relancer ne refait que le reste.
 *   npm run audio              tout traiter
 *   npm run audio -- --limit 5 n'en traiter que 5 (test)
 */
import { execFile, spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { config, validateConfig } from './config.js';
import { FreeboxClient } from './lib/freebox.js';
import { CatalogStore } from './lib/store.js';
import { uploadSiteFile } from './lib/site-ftp.js';
import { errorMessage } from './lib/utils.js';

const run = promisify(execFile);
const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIO_DIR_NAME = 'AlexFlix-audio';
const AUDIO_DIR = `${config.freeboxMediaRoot}/${AUDIO_DIR_NAME}`;
/** Codecs que tous les navigateurs lisent : pas besoin de piste séparée. */
const NATIVE = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);
const CONCURRENCY = 3;
/** Publication du catalogue (sons prêts) tous les N films convertis. */
const PUBLISH_EVERY = 25;

export interface AudioTrack {
  status: 'native' | 'done' | 'failed';
  relPath: string;
  codec?: string;
  token?: string;
  url?: string;
  expire?: number;
  error?: string;
}

interface LinkRecord {
  token: string;
  url: string;
  expire: number;
  relPath: string;
}

interface ProbeStream {
  index: number;
  codec_name?: string;
  disposition?: { default?: number };
  tags?: { language?: string };
}

const log = (message: string): void => console.log(`[audio] ${message}`);
export const audioTracksFile = (): string => path.join(config.dataDir, 'audio-tracks.json');

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Piste à jouer : française si présente, sinon celle par défaut, sinon la première. */
function pickStream(streams: ProbeStream[]): { stream: ProbeStream; isFirst: boolean } | null {
  if (streams.length === 0) return null;
  const french = streams.find((stream) => /^(fre|fra|fr|french)$/i.test(stream.tags?.language ?? ''));
  const chosen = french ?? streams.find((stream) => stream.disposition?.default === 1) ?? streams[0];
  return { stream: chosen, isFirst: chosen.index === streams[0].index };
}

async function probe(url: string): Promise<ProbeStream[]> {
  const { stdout } = await run(
    config.ffprobePath,
    ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index,codec_name:stream_disposition=default:stream_tags=language', '-of', 'json', url],
    { timeout: 120000, maxBuffer: 4 * 1024 * 1024 }
  );
  return (JSON.parse(stdout) as { streams?: ProbeStream[] }).streams ?? [];
}

function extract(url: string, streamIndex: number, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      config.ffmpegPath,
      ['-v', 'error', '-y', '-i', url, '-vn', '-map', `0:${streamIndex}`, '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-movflags', '+faststart', output],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code} : ${stderr.trim().split('\n').pop() ?? ''}`))));
  });
}

/** La Freebox répond parfois 5XX sous charge : 3 essais espacés. */
async function retry<T>(task: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 10000));
    }
  }
}

/** Verrou : une seule conversion à la fois (deploy, synchro depuis le site, lancement manuel). */
const lockFile = (): string => path.join(config.dataDir, 'audio.lock');
async function acquireLock(): Promise<boolean> {
  try {
    const pid = Number((await fs.readFile(lockFile(), 'utf8')).trim());
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        // processus mort : verrou périmé
      }
    }
  } catch {
    // pas de verrou
  }
  await fs.writeFile(lockFile(), String(process.pid));
  const release = (): void => {
    try {
      rmSync(lockFile(), { force: true });
    } catch {
      // ignore
    }
  };
  process.once('exit', release);
  return true;
}

async function main(): Promise<void> {
  if (!(await acquireLock())) {
    log('Une conversion est déjà en cours : rien à faire.');
    return;
  }
  validateConfig('deploy');
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : Infinity;

  const store = new CatalogStore(config.dataDir);
  await store.load();
  const links = await readJson<Record<string, LinkRecord>>(path.join(config.dataDir, 'share-links.json'), {});
  const tracks = await readJson<Record<string, AudioTrack>>(audioTracksFile(), {});

  const todo = Object.values(store.data.files)
    .filter((file) => links[file.id]?.url)
    .filter((file) => {
      const track = tracks[file.id];
      return !track || track.relPath !== file.relPath || track.status === 'failed';
    })
    .slice(0, limit);

  log(`${Object.keys(store.data.files).length} vidéos, ${todo.length} à traiter.`);

  /** État lu par la page Paramètres du site (audio-status.json à la racine de l'hébergement). */
  const totalVideos = Object.values(store.data.files).filter((file) => links[file.id]?.url).length;
  const current = new Set<string>();
  const startedAt = new Date().toISOString();
  let lastPublishAt: string | null = null;
  let publishedReady = 0;
  let statusTimer: NodeJS.Timeout | null = null;
  let statusChain = Promise.resolve();
  const counts = () => {
    const byStatus = { done: 0, native: 0, failed: 0 };
    for (const [id, track] of Object.entries(tracks)) {
      if (store.data.files[id]?.relPath !== track.relPath) continue;
      byStatus[track.status]++;
    }
    return byStatus;
  };
  const pushStatus = (running: boolean, etaMinutes: number | null): void => {
    const byStatus = counts();
    const body = JSON.stringify({
      updatedAt: new Date().toISOString(),
      startedAt,
      running,
      total: totalVideos,
      ...byStatus,
      remaining: Math.max(0, totalVideos - byStatus.done - byStatus.native),
      etaMinutes,
      current: [...current],
      published: publishedReady,
      publishedAt: lastPublishAt
    });
    statusChain = statusChain.then(() => uploadSiteFile('audio-status.json', body).catch((error) => log(`Statut non envoyé : ${errorMessage(error)}`)));
  };
  const scheduleStatus = (etaMinutes: number | null): void => {
    if (statusTimer) return;
    statusTimer = setTimeout(() => {
      statusTimer = null;
      pushStatus(true, etaMinutes);
    }, 15000);
  };

  let publishing: Promise<void> | null = null;
  const publish = (): Promise<void> => {
    publishing ??= new Promise<void>((resolve) => {
      const ready = counts().done;
      const child = spawn(process.execPath, [path.join(SERVER_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/deploy-cli.ts', '--no-links'], {
        cwd: SERVER_DIR,
        stdio: 'ignore'
      });
      child.on('close', (code) => {
        if (code === 0) {
          publishedReady = ready;
          lastPublishAt = new Date().toISOString();
          log(`Site mis à jour : ${ready} piste(s) son publiée(s).`);
        } else log(`Publication intermédiaire échouée (code ${code}).`);
        publishing = null;
        resolve();
      });
      child.on('error', () => {
        publishing = null;
        resolve();
      });
    });
    return publishing;
  };

  if (todo.length === 0) {
    pushStatus(false, 0);
    await statusChain;
    return;
  }
  pushStatus(true, null);

  const freebox = new FreeboxClient(log);
  await freebox.open();
  await freebox.ensureDir(config.freeboxMediaRoot, AUDIO_DIR_NAME);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'alexflix-audio-'));
  const expire = config.freeboxLinkDays > 0 ? Math.floor(Date.now() / 1000) + config.freeboxLinkDays * 86400 : 0;

  let saving = Promise.resolve();
  const save = (): Promise<void> => {
    // Écriture atomique : le deploy peut lire ce fichier pendant le traitement.
    saving = saving.then(async () => {
      const tmp = `${audioTracksFile()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(tracks, null, 2));
      await fs.rename(tmp, audioTracksFile());
    });
    return saving;
  };

  let next = 0;
  let done = 0;
  const started = Date.now();
  const worker = async (): Promise<void> => {
    while (next < todo.length) {
      const file = todo[next++];
      const url = links[file.id].url;
      const name = path.posix.basename(file.relPath);
      current.add(name);
      try {
        const picked = pickStream(await retry(() => probe(url)));
        if (!picked) {
          tracks[file.id] = { status: 'native', relPath: file.relPath, codec: 'aucun' };
        } else if (picked.isFirst && NATIVE.has(picked.stream.codec_name ?? '')) {
          tracks[file.id] = { status: 'native', relPath: file.relPath, codec: picked.stream.codec_name };
        } else {
          const local = path.join(tmpDir, `${file.id}.m4a`);
          await retry(() => extract(url, picked.stream.index, local));
          await retry(() => freebox.uploadFile(AUDIO_DIR, `${file.id}.m4a`, local));
          await fs.rm(local, { force: true });
          const previous = tracks[file.id]?.token;
          const link = await freebox.createShareLink(`${AUDIO_DIR}/${file.id}.m4a`, expire);
          if (previous && previous !== link.token) await freebox.deleteShareLink(previous).catch(() => undefined);
          tracks[file.id] = {
            status: 'done',
            relPath: file.relPath,
            codec: picked.stream.codec_name,
            token: link.token,
            url: freebox.publicUrl(link),
            expire: link.expire ?? expire
          };
        }
      } catch (error) {
        tracks[file.id] = { status: 'failed', relPath: file.relPath, error: errorMessage(error) };
        console.warn(`\n[audio] Échec « ${name} » : ${errorMessage(error)}`);
      }
      await save();
      current.delete(name);
      done++;
      // Temps réel écoulé par fichier (déjà parallélisé) × fichiers restants.
      const perFile = (Date.now() - started) / done;
      const left = Math.round(((todo.length - done) * perFile) / 60000);
      log(`${done}/${todo.length} · ${tracks[file.id].status} · ${name} · reste ~${left} min`);
      scheduleStatus(left);
      if (counts().done - publishedReady >= PUBLISH_EVERY) void publish();
    }
  };

  try {
    await freebox.resolveShareDomain();
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  } finally {
    await saving;
    await freebox.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
    if (statusTimer) clearTimeout(statusTimer);
    if (publishing) await publishing;
    await publish();
    pushStatus(false, 0);
    await statusChain;
  }
  const summary = Object.values(tracks).reduce<Record<string, number>>((acc, track) => ({ ...acc, [track.status]: (acc[track.status] ?? 0) + 1 }), {});
  log(`Terminé : ${JSON.stringify(summary)}. Pistes publiées sur le site.`);
}

main().catch((error) => {
  console.error(`[audio] ${errorMessage(error)}`);
  process.exit(1);
});
