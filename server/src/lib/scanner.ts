import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { Catalog, LookupEntry, MediaFile, MediaItem, MediaType, ParsedName, ScanStatus } from '../types.js';
import { FreeboxClient, toFreeboxPath, type FreeboxEntry } from './freebox.js';
import { ensureImagesDir, pruneImages } from './images.js';
import { createLimiter } from './limiter.js';
import { fetchMeta, fetchSeason, localItemId, localMeta, tmdbItemId } from './metadata.js';
import { lookupKeyOf, parseMediaPath } from './parser.js';
import { CatalogStore, emptyCatalog } from './store.js';
import { searchTmdb, tmdbEnabled } from './tmdb.js';
import { errorMessage, fileIdFor, nowIso } from './utils.js';

const IGNORED_NAMES = new Set([
  '$recycle.bin',
  'system volume information',
  '@eadir',
  '#recycle',
  'lost+found',
  '.trash',
  'sample',
  'samples',
  'extras',
  'featurettes',
  'found.000',
  'musiques',
  'musique',
  'photos',
  'enregistrements'
]);
const SAMPLE_RE = /(^|[\s._-])sample([\s._-]|$)/i;
const LOOKUP_RETRY_MS = 7 * 24 * 3600 * 1000;
const MAX_ERRORS = 50;

interface FoundFile {
  relPath: string;
  size: number;
  mtimeMs: number;
  ext: string;
}

interface PendingFile extends FoundFile {
  id: string;
  parsed: ParsedName;
  key: string;
}

interface Match {
  tmdbId: number;
  type: MediaType;
}

type HttpError = Error & { statusCode?: number };

function httpError(message: string, statusCode: number): HttpError {
  return Object.assign(new Error(message), { statusCode });
}

export function idleStatus(): ScanStatus {
  return {
    running: false,
    phase: 'idle',
    full: false,
    startedAt: null,
    finishedAt: null,
    filesFound: 0,
    newFiles: 0,
    removedFiles: 0,
    processed: 0,
    itemsTotal: 0,
    errors: [],
    lastError: null
  };
}

function keepManual(lookups: Record<string, LookupEntry>): Record<string, LookupEntry> {
  return Object.fromEntries(Object.entries(lookups).filter(([, entry]) => entry.manual === true));
}

export class Scanner {
  private status: ScanStatus = idleStatus();
  private running: Promise<void> | null = null;
  private rematching = false;
  private pendingItems = new Map<string, Promise<MediaItem>>();
  private pendingSeasons = new Map<string, Promise<void>>();

  constructor(private readonly store: CatalogStore) {
    this.status.itemsTotal = Object.keys(store.data.items).length;
  }

  get isRunning(): boolean {
    return this.running !== null;
  }

  getStatus(): ScanStatus {
    return { ...this.status, errors: [...this.status.errors] };
  }

  start(full = false): boolean {
    if (this.running || this.rematching) return false;
    this.running = this.run(full).finally(() => {
      this.running = null;
    });
    return true;
  }

  async wait(): Promise<void> {
    if (this.running) await this.running;
  }

  private pushError(message: string): void {
    this.status.errors.push(message);
    if (this.status.errors.length > MAX_ERRORS) this.status.errors.splice(0, this.status.errors.length - MAX_ERRORS);
  }

  private async run(full: boolean): Promise<void> {
    this.status = { ...idleStatus(), running: true, full, phase: 'walking', startedAt: nowIso() };
    this.pendingItems.clear();
    this.pendingSeasons.clear();
    try {
      await ensureImagesDir();
      const found = await this.collect();
      this.status.filesFound = found.length;

      this.store.baselineAt();
      const previous = this.store.data;
      const working: Catalog = full
        ? { ...emptyCatalog(), baselineAt: this.store.baselineAt() ?? undefined, lookups: keepManual(previous.lookups) }
        : structuredClone(previous);
      const previousAdded = new Map(Object.values(previous.files).map((file) => [file.relPath, file.addedAt]));

      const knownCount = Object.keys(previous.files).length;
      if (!full && knownCount >= 20 && found.length < knownCount * 0.8) {
        throw new Error(
          `Protection : seulement ${found.length} fichiers trouvés sur ${knownCount} connus. Le disque de la Freebox est peut-être déconnecté ou illisible : rien n'a été modifié. Rebranchez-le et relancez (ou utilisez un scan complet si ces fichiers ont vraiment été supprimés).`
        );
      }

      const seen = new Set<string>();
      const todo: PendingFile[] = [];
      for (const file of found) {
        const id = fileIdFor(file.relPath);
        if (seen.has(id)) continue;
        seen.add(id);
        const existing = working.files[id];
        if (existing && existing.size === file.size && !this.needsRetry(working, existing)) continue;
        const parsed = parseMediaPath(file.relPath, config.moviesDir, config.seriesDir);
        todo.push({ ...file, id, parsed, key: lookupKeyOf(parsed) });
      }

      for (const id of Object.keys(working.files)) {
        if (!seen.has(id)) {
          this.detach(working, id);
          this.status.removedFiles++;
        }
      }

      this.status.newFiles = todo.length;
      this.status.phase = 'matching';

      const groups = new Map<string, PendingFile[]>();
      for (const file of todo) {
        const group = groups.get(file.key);
        if (group) group.push(file);
        else groups.set(file.key, [file]);
      }

      const limit = createLimiter(4);
      let sinceSave = 0;
      await Promise.all(
        [...groups.entries()].map(([key, files]) =>
          limit(async () => {
            try {
              await this.processGroup(working, key, files, previousAdded);
            } catch (error) {
              this.pushError(`${files[0].relPath} : ${errorMessage(error)}`);
            }
            sinceSave += files.length;
            if (sinceSave >= 50) {
              sinceSave = 0;
              await this.store.write(working).catch(() => undefined);
            }
          })
        )
      );

      this.status.phase = 'saving';
      if (!working.baselineAt) working.baselineAt = nowIso();
      this.store.replace(working);
      await this.store.save();
      await pruneImages(new Set(Object.keys(working.items)));
      this.status.itemsTotal = Object.keys(working.items).length;
      this.status.phase = 'done';
    } catch (error) {
      const message = errorMessage(error);
      this.status.phase = 'error';
      this.status.lastError = message;
      this.pushError(message);
    } finally {
      this.status.running = false;
      this.status.finishedAt = nowIso();
    }
  }

  private needsRetry(working: Catalog, file: MediaFile): boolean {
    const item = working.items[file.itemId];
    if (!item) return true;
    if (item.tmdbId !== null || !tmdbEnabled()) return false;
    const entry = working.lookups[file.lookupKey];
    if (entry?.manual) return true;
    return !entry || (entry.tmdbId === null && Date.now() - Date.parse(entry.at) > LOOKUP_RETRY_MS);
  }

  private async collect(): Promise<FoundFile[]> {
    const rootStat = config.mediaPath ? await fs.stat(config.mediaPath).catch(() => null) : null;
    const smbReady = Boolean(rootStat?.isDirectory());
    if (config.scanSource === 'smb' || (config.scanSource === 'auto' && smbReady)) {
      if (!smbReady) throw new Error(`MEDIA_PATH inaccessible : ${config.mediaPath} (partage Freebox monté ?)`);
      return this.walk(config.mediaPath);
    }
    return this.walkFreebox();
  }

  private isIgnored(name: string): boolean {
    const lower = name.toLowerCase();
    return name.startsWith('.') || IGNORED_NAMES.has(lower) || config.scanExclude.includes(lower);
  }

  private async walkFreebox(): Promise<FoundFile[]> {
    const freebox = new FreeboxClient((message) => console.log(`[freebox] ${message}`));
    await freebox.open();
    const out: FoundFile[] = [];
    const extensions = new Set(config.videoExtensions);
    const limit = createLimiter(6);
    const visit = async (encodedPath: string, rel: string): Promise<void> => {
      let entries: FreeboxEntry[];
      try {
        entries = await limit(() => freebox.listDir(encodedPath));
      } catch (error) {
        this.pushError(`Lecture Freebox impossible de « ${rel || config.freeboxMediaRoot} » : ${errorMessage(error)}`);
        if (!rel) throw new Error(`Dossier Freebox introuvable : ${config.freeboxMediaRoot} (${errorMessage(error)})`);
        return;
      }
      const children: Array<Promise<void>> = [];
      for (const entry of entries) {
        const name = entry.name;
        if (entry.hidden || this.isIgnored(name)) continue;
        const relPath = rel ? `${rel}/${name}` : name;
        if (entry.type === 'dir') {
          children.push(visit(entry.path || toFreeboxPath(`${config.freeboxMediaRoot}/${relPath}`), relPath));
          continue;
        }
        const ext = path.extname(name).toLowerCase();
        if (!extensions.has(ext) || SAMPLE_RE.test(name)) continue;
        out.push({ relPath, size: Number(entry.size) || 0, mtimeMs: (Number(entry.modification) || 0) * 1000, ext });
        this.status.filesFound = out.length;
      }
      await Promise.all(children);
    };
    try {
      await visit(toFreeboxPath(config.freeboxMediaRoot), '');
    } finally {
      await freebox.close();
    }
    return out;
  }

  private async walk(root: string): Promise<FoundFile[]> {
    const out: FoundFile[] = [];
    const extensions = new Set(config.videoExtensions);
    const visit = async (dir: string, rel: string): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (error) {
        this.pushError(`Lecture impossible de « ${rel || '/'} » : ${errorMessage(error)}`);
        return;
      }
      for (const entry of entries) {
        const name = entry.name;
        if (this.isIgnored(name)) continue;
        const abs = path.join(dir, name);
        const relPath = rel ? `${rel}/${name}` : name;
        if (entry.isDirectory()) {
          await visit(abs, relPath);
          continue;
        }
        if (!entry.isFile() && !entry.isSymbolicLink()) continue;
        const ext = path.extname(name).toLowerCase();
        if (!extensions.has(ext) || SAMPLE_RE.test(name)) continue;
        try {
          const stat = await fs.stat(abs);
          if (stat.isFile()) out.push({ relPath, size: stat.size, mtimeMs: Math.round(stat.mtimeMs), ext });
          this.status.filesFound = out.length;
        } catch (error) {
          this.pushError(`stat impossible « ${relPath} » : ${errorMessage(error)}`);
        }
      }
    };
    await visit(root, '');
    return out;
  }

  private detach(working: Catalog, fileId: string, keepItemId?: string): void {
    const file = working.files[fileId];
    if (!file) return;
    delete working.files[fileId];
    const item = working.items[file.itemId];
    if (!item) return;
    item.fileIds = item.fileIds.filter((id) => id !== fileId);
    if (item.fileIds.length === 0 && item.id !== keepItemId) delete working.items[item.id];
  }

  private async resolve(working: Catalog, key: string, parsed: ParsedName): Promise<Match | null> {
    const entry = working.lookups[key];
    if (entry?.manual && entry.tmdbId !== null) return { tmdbId: entry.tmdbId, type: entry.type ?? parsed.type };
    if (!tmdbEnabled()) return null;
    if (entry && (entry.tmdbId !== null || Date.now() - Date.parse(entry.at) < LOOKUP_RETRY_MS)) {
      return entry.tmdbId === null ? null : { tmdbId: entry.tmdbId, type: entry.type ?? parsed.type };
    }
    try {
      const tmdbId = await searchTmdb(parsed.type, parsed.title, parsed.year);
      working.lookups[key] = { tmdbId, type: parsed.type, at: nowIso() };
      return tmdbId === null ? null : { tmdbId, type: parsed.type };
    } catch (error) {
      this.pushError(`Recherche TMDB « ${parsed.title} » : ${errorMessage(error)}`);
      return null;
    }
  }

  private ensureItem(working: Catalog, itemId: string, match: Match | null, parsed: ParsedName): Promise<MediaItem> {
    const existing = working.items[itemId];
    if (existing) return Promise.resolve(existing);
    let pending = this.pendingItems.get(itemId);
    if (!pending) {
      pending = (async () => {
        const meta = match ? await fetchMeta(itemId, match.type, match.tmdbId) : localMeta(parsed);
        const item: MediaItem = { id: itemId, ...meta, seasons: {}, fileIds: [], addedAt: '' };
        working.items[itemId] = working.items[itemId] ?? item;
        return working.items[itemId];
      })();
      this.pendingItems.set(itemId, pending);
      pending.catch(() => this.pendingItems.delete(itemId));
    }
    return pending;
  }

  private async ensureSeason(item: MediaItem, season: number): Promise<void> {
    const key = String(season);
    if (item.seasons[key] || item.tmdbId === null) return;
    const pendingKey = `${item.id}:${key}`;
    let pending = this.pendingSeasons.get(pendingKey);
    if (!pending) {
      const tmdbId = item.tmdbId;
      pending = fetchSeason(item.id, tmdbId, season)
        .then((meta) => {
          item.seasons[key] = meta;
        })
        .catch((error: unknown) => {
          this.pushError(`Saison ${season} de « ${item.title} » : ${errorMessage(error)}`);
        });
      this.pendingSeasons.set(pendingKey, pending);
    }
    await pending;
  }

  private async processGroup(
    working: Catalog,
    key: string,
    files: PendingFile[],
    previousAdded: Map<string, string>
  ): Promise<void> {
    const parsed = files[0].parsed;
    const match = await this.resolve(working, key, parsed);
    const itemId = match ? tmdbItemId(match.type, match.tmdbId) : localItemId(parsed);
    const item = await this.ensureItem(working, itemId, match, parsed);

    for (const pending of files) {
      if (working.files[pending.id]) this.detach(working, pending.id, itemId);
      const file: MediaFile = {
        id: pending.id,
        relPath: pending.relPath,
        size: pending.size,
        mtimeMs: pending.mtimeMs,
        ext: pending.ext,
        itemId,
        lookupKey: key,
        season: pending.parsed.season,
        episode: pending.parsed.episode,
        addedAt: previousAdded.get(pending.relPath) ?? nowIso()
      };
      working.files[pending.id] = file;
      working.items[itemId] = item;
      if (!item.fileIds.includes(pending.id)) item.fileIds.push(pending.id);
      if (file.addedAt > item.addedAt) item.addedAt = file.addedAt;
      if (item.type === 'tv' && item.tmdbId !== null && file.season !== null) await this.ensureSeason(item, file.season);
      this.status.processed++;
    }
  }

  async rematch(itemId: string, tmdbId: number, type?: MediaType): Promise<MediaItem> {
    if (this.running) throw httpError('Scan en cours, réessayez dans un instant.', 409);
    if (this.rematching) throw httpError('Une correction est déjà en cours.', 409);
    this.rematching = true;
    try {
      const catalog = this.store.data;
      const current = catalog.items[itemId];
      if (!current) throw httpError('Titre introuvable.', 404);
      const targetType = type ?? current.type;
      const targetId = tmdbItemId(targetType, tmdbId);
      const meta = await fetchMeta(targetId, targetType, tmdbId).catch((error: unknown) => {
        throw httpError(`TMDB : ${errorMessage(error)}`, 502);
      });

      let target = catalog.items[targetId];
      if (targetId === itemId) {
        Object.assign(current, meta);
        current.seasons = {};
        target = current;
      } else if (!target) {
        target = { id: targetId, ...meta, seasons: {}, fileIds: [], addedAt: current.addedAt };
        catalog.items[targetId] = target;
      }

      for (const fileId of current.fileIds) {
        const file = catalog.files[fileId];
        if (!file) continue;
        file.itemId = targetId;
        if (!target.fileIds.includes(fileId)) target.fileIds.push(fileId);
        catalog.lookups[file.lookupKey] = { tmdbId, type: targetType, at: nowIso(), manual: true };
      }
      if (targetId !== itemId) delete catalog.items[itemId];
      if (current.addedAt > target.addedAt) target.addedAt = current.addedAt;

      if (targetType === 'tv') {
        const seasons = new Set(
          target.fileIds.map((id) => catalog.files[id]?.season).filter((season): season is number => typeof season === 'number')
        );
        for (const season of seasons) {
          if (target.seasons[String(season)]) continue;
          try {
            target.seasons[String(season)] = await fetchSeason(targetId, tmdbId, season);
          } catch (error) {
            this.pushError(`Saison ${season} de « ${target.title} » : ${errorMessage(error)}`);
          }
        }
      }

      await this.store.save();
      await pruneImages(new Set(Object.keys(catalog.items)));
      this.status.itemsTotal = Object.keys(catalog.items).length;
      return target;
    } finally {
      this.rematching = false;
    }
  }
}
