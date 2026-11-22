import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { decide, probeFile, spawnTranscode, transcodeAvailable } from '../lib/ffmpeg.js';
import type { CatalogStore } from '../lib/store.js';
import { isInside, videoMime } from '../lib/utils.js';
import type { MediaFile } from '../types.js';

interface ResolvedFile {
  file: MediaFile;
  abs: string;
  size: number;
}

export function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start: number;
  let end: number;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix === 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= size || start > end) return null;
  return { start, end };
}

export function streamRoutes(app: FastifyInstance, store: CatalogStore): void {
  const resolveFile = async (id: string): Promise<ResolvedFile | null> => {
    const file = store.data.files[id];
    if (!file) return null;
    const abs = path.resolve(config.mediaPath, ...file.relPath.split('/'));
    if (!isInside(config.mediaPath, abs)) return null;
    const stat = await fs.promises.stat(abs).catch(() => null);
    if (!stat?.isFile()) return null;
    return { file, abs, size: stat.size };
  };

  app.get<{ Params: { id: string }; Querystring: { download?: string } }>('/api/stream/:id', async (request, reply) => {
    const target = await resolveFile(request.params.id);
    if (!target) return reply.code(404).send({ error: 'Fichier introuvable ou partage Freebox indisponible.' });
    const { abs, size, file } = target;

    reply
      .header('Accept-Ranges', 'bytes')
      .header('Content-Type', videoMime(file.ext))
      .header('Cache-Control', 'private, no-transform');
    if (request.query.download !== undefined) {
      const name = path.posix.basename(file.relPath);
      const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
      reply.header('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    }

    const range = request.headers.range;
    if (!range) {
      reply.header('Content-Length', String(size));
      return reply.send(fs.createReadStream(abs, { highWaterMark: 1 << 20 }));
    }

    const parsed = parseRange(range, size);
    if (!parsed) {
      reply.header('Content-Range', `bytes */${size}`);
      return reply.code(416).send();
    }

    const { start, end } = parsed;
    reply
      .code(206)
      .header('Content-Range', `bytes ${start}-${end}/${size}`)
      .header('Content-Length', String(end - start + 1));
    return reply.send(fs.createReadStream(abs, { start, end, highWaterMark: 1 << 20 }));
  });

  app.get<{ Params: { id: string } }>('/api/stream/:id/info', async (request, reply) => {
    const target = await resolveFile(request.params.id);
    if (!target) return reply.code(404).send({ error: 'Fichier introuvable ou partage Freebox indisponible.' });
    const info = await probeFile(`${target.file.id}:${target.size}`, target.abs);
    const decision = decide(target.file.ext, info);
    return {
      duration: info?.duration ?? null,
      videoCodec: info?.videoCodec ?? null,
      audioCodec: info?.audioCodec ?? null,
      width: info?.width ?? null,
      height: info?.height ?? null,
      audioLanguages: info?.audioLanguages ?? [],
      needsTranscode: decision.needsTranscode,
      transcodeAvailable: transcodeAvailable(),
      reason: decision.reason
    };
  });

  app.get<{ Params: { id: string }; Querystring: { start?: string } }>('/api/stream/:id/transcode', async (request, reply) => {
    if (!transcodeAvailable()) return reply.code(503).send({ error: 'Transcodage FFmpeg désactivé ou binaire introuvable.' });
    const target = await resolveFile(request.params.id);
    if (!target) return reply.code(404).send({ error: 'Fichier introuvable ou partage Freebox indisponible.' });

    const start = Math.max(0, Number(request.query.start) || 0);
    const info = await probeFile(`${target.file.id}:${target.size}`, target.abs);
    const decision = decide(target.file.ext, info);
    const child = spawnTranscode(target.abs, start, decision.copyVideo, info?.audioIndex ?? null);

    const kill = (): void => {
      if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
    };
    reply.raw.on('close', kill);
    child.on('error', (error) => {
      request.log.error({ err: error }, 'ffmpeg spawn');
      kill();
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      const line = chunk.trim();
      if (line) request.log.warn({ ffmpeg: line }, 'ffmpeg');
    });

    reply.header('Content-Type', 'video/mp4').header('Cache-Control', 'no-store');
    return reply.send(child.stdout);
  });
}
