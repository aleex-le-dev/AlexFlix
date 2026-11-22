import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { createLimiter } from './limiter.js';
import { TMDB_IMAGE_BASE } from './tmdb.js';
import { errorMessage } from './utils.js';

export const imagesDir = path.join(config.dataDir, 'images');
export const IMAGE_NAME_RE = /^[a-z0-9-]+\.jpg$/;
const OWNER_RE = /^([a-z0-9-]+?)-(poster|backdrop|s\d+e\d+|season\d+)\.jpg$/;
const limit = createLimiter(4);

export async function ensureImagesDir(): Promise<void> {
  await fs.mkdir(imagesDir, { recursive: true });
}

export async function cacheImage(tmdbPath: string | null | undefined, size: string, name: string): Promise<string | null> {
  if (!tmdbPath) return null;
  const file = `${name}.jpg`;
  const target = path.join(imagesDir, file);
  if (existsSync(target)) return file;
  try {
    await limit(async () => {
      const response = await fetch(`${TMDB_IMAGE_BASE}/${size}${tmdbPath}`, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, buffer);
      await fs.rename(tmp, target);
    });
    return file;
  } catch (error) {
    console.warn(`[images] échec ${name} : ${errorMessage(error)}`);
    return null;
  }
}

export async function pruneImages(validItemIds: Set<string>): Promise<number> {
  let entries: string[];
  try {
    entries = await fs.readdir(imagesDir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    const owner = OWNER_RE.exec(entry);
    if (entry.endsWith('.tmp') || (owner && !validItemIds.has(owner[1]))) {
      await fs.rm(path.join(imagesDir, entry), { force: true }).catch(() => undefined);
      removed++;
    }
  }
  return removed;
}
