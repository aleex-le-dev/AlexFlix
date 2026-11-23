/**
 * Images optimisées pour la vitrine (WebP, ~35 % plus léger que le JPEG) générées par FFmpeg au deploy.
 *
 *   affiche  <id>-poster.jpg   → <id>-poster.sm.webp (342 px, rangées) + <id>-poster.webp (500 px, fiche)
 *   fond     <id>-backdrop.jpg → <id>-backdrop.webp (1280 px) + <id>-backdrop.hd.webp (1920 px, bannière / TV)
 *   autres (saisons, épisodes, acteurs) → <nom>.webp à la même taille
 *
 * Le 1920 px vient de l'image « original » TMDB (data/images-hd/), téléchargée une fois par titre.
 * Les JPEG d'origine restent publiés (/images/) : avatars « affiche de film » des profils.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { MediaItem } from '../types.js';
import { imagesDir } from './images.js';
import { createLimiter } from './limiter.js';
import { TMDB_IMAGE_BASE, tmdbEnabled, tmdbRequest } from './tmdb.js';
import { errorMessage } from './utils.js';

export const webImagesDir = path.join(config.dataDir, 'images-web');
const hdDir = path.join(config.dataDir, 'images-hd');
const QUALITY = 80;

interface Variant {
  file: string;
  width: number | null;
  source: string;
}

function variantsFor(name: string): Variant[] {
  const base = name.replace(/\.jpg$/i, '');
  const source = path.join(imagesDir, name);
  if (base.endsWith('-poster')) {
    return [
      { file: `${base}.sm.webp`, width: 342, source },
      { file: `${base}.webp`, width: 500, source }
    ];
  }
  if (base.endsWith('-backdrop')) {
    const hd = path.join(hdDir, name);
    return [
      { file: `${base}.webp`, width: 1280, source },
      { file: `${base}.hd.webp`, width: 1920, source: existsSync(hd) ? hd : source }
    ];
  }
  return [{ file: `${base}.webp`, width: null, source }];
}

function toWebp(source: string, target: string, width: number | null): Promise<void> {
  const scale = width ? ['-vf', `scale='min(${width},iw)':-2:flags=lanczos`] : [];
  return new Promise((resolve, reject) => {
    const child = spawn(config.ffmpegPath, ['-v', 'error', '-y', '-i', source, ...scale, '-c:v', 'libwebp', '-quality', String(QUALITY), '-preset', 'picture', target], {
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim().split('\n').pop() ?? `ffmpeg ${code}`))));
  });
}

/** Fond « original » TMDB (souvent 3840 px) pour une bannière nette sur grand écran ; téléchargé une seule fois. */
export async function fetchHdBackdrops(items: MediaItem[], log: (message: string) => void): Promise<void> {
  if (!tmdbEnabled()) return;
  await fs.mkdir(hdDir, { recursive: true });
  const missing = items.filter((item) => item.backdrop && item.tmdbId && !existsSync(path.join(hdDir, item.backdrop)));
  if (missing.length === 0) return;
  log(`Fonds HD : ${missing.length} à télécharger depuis TMDB…`);
  const limit = createLimiter(6);
  let done = 0;
  await Promise.all(
    missing.map((item) =>
      limit(async () => {
        try {
          const details = await tmdbRequest<{ backdrop_path?: string | null }>(`/${item.type}/${item.tmdbId}`);
          if (!details.backdrop_path) return;
          const response = await fetch(`${TMDB_IMAGE_BASE}/original${details.backdrop_path}`, { signal: AbortSignal.timeout(60000) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const target = path.join(hdDir, item.backdrop as string);
          await fs.writeFile(`${target}.tmp`, Buffer.from(await response.arrayBuffer()));
          await fs.rename(`${target}.tmp`, target);
          done++;
        } catch (error) {
          console.warn(`[images] fond HD « ${item.title} » : ${errorMessage(error)}`);
        }
      })
    )
  );
  log(`Fonds HD : ${done} téléchargé(s).`);
}

/** Génère les WebP manquants ou périmés ; renvoie la liste des fichiers à publier dans /img/. */
export async function buildWebImages(names: Iterable<string>, log: (message: string) => void): Promise<string[]> {
  await fs.mkdir(webImagesDir, { recursive: true });
  const variants = [...new Set(names)].flatMap(variantsFor).filter((variant) => existsSync(variant.source));
  const limit = createLimiter(6);
  let built = 0;
  let failed = 0;
  await Promise.all(
    variants.map((variant) =>
      limit(async () => {
        const target = path.join(webImagesDir, variant.file);
        const [sourceStat, targetStat] = await Promise.all([fs.stat(variant.source), fs.stat(target).catch(() => null)]);
        if (targetStat && targetStat.mtimeMs >= sourceStat.mtimeMs) return;
        try {
          await toWebp(variant.source, target, variant.width);
          built++;
          if (built % 200 === 0) log(`Images WebP : ${built} générée(s)…`);
        } catch (error) {
          failed++;
          console.warn(`[images] WebP ${variant.file} : ${errorMessage(error)}`);
        }
      })
    )
  );
  if (built || failed) log(`Images WebP : ${built} générée(s)${failed ? `, ${failed} échec(s)` : ''}.`);
  return variants.map((variant) => variant.file).filter((file) => existsSync(path.join(webImagesDir, file)));
}
