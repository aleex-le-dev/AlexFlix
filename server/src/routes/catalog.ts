import type { FastifyInstance } from 'fastify';
import { transcodeAvailable } from '../lib/ffmpeg.js';
import { readPeople } from '../lib/people.js';
import type { Scanner } from '../lib/scanner.js';
import type { CatalogStore } from '../lib/store.js';
import { tmdbEnabled } from '../lib/tmdb.js';
import type { MediaType } from '../types.js';

interface Deps {
  store: CatalogStore;
  scanner: Scanner;
}

export function catalogRoutes(app: FastifyInstance, { store, scanner }: Deps): void {
  app.get('/api/catalog', async () => {
    const { genres, keywords } = store.facets();
    return {
      updatedAt: store.data.updatedAt,
      baselineAt: store.baselineAt(),
      people: await readPeople(),
      items: store.list(),
      genres,
      keywords,
      scan: scanner.getStatus(),
      tmdbEnabled: tmdbEnabled(),
      transcodeAvailable: transcodeAvailable()
    };
  });

  app.get<{ Params: { id: string } }>('/api/items/:id', async (request, reply) => {
    const item = store.data.items[request.params.id];
    if (!item) return reply.code(404).send({ error: 'Titre introuvable.' });
    return store.toDTO(item);
  });

  app.post<{ Params: { id: string }; Body: { tmdbId: number; type?: MediaType } }>(
    '/api/items/:id/match',
    {
      schema: {
        body: {
          type: 'object',
          required: ['tmdbId'],
          properties: {
            tmdbId: { type: 'integer', minimum: 1 },
            type: { type: 'string', enum: ['movie', 'tv'] }
          }
        }
      }
    },
    async (request, reply) => {
      if (!tmdbEnabled()) return reply.code(400).send({ error: 'TMDB_API_KEY manquante dans .env.' });
      try {
        const item = await scanner.rematch(request.params.id, request.body.tmdbId, request.body.type);
        return store.toDTO(item);
      } catch (error) {
        const failure = error as Error & { statusCode?: number };
        return reply.code(failure.statusCode ?? 502).send({ error: failure.message });
      }
    }
  );

  app.post<{ Body: { full?: boolean } | undefined }>('/api/scan', async (request, reply) => {
    const started = scanner.start(Boolean(request.body?.full));
    return reply.code(started ? 202 : 409).send({ started, status: scanner.getStatus() });
  });

  app.get('/api/scan/status', async () => scanner.getStatus());
}
