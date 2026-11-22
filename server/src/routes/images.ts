import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { IMAGE_NAME_RE, imagesDir } from '../lib/images.js';

export function imageRoutes(app: FastifyInstance): void {
  app.get<{ Params: { name: string } }>('/api/images/:name', async (request, reply) => {
    const { name } = request.params;
    if (!IMAGE_NAME_RE.test(name)) return reply.code(400).send({ error: "Nom d'image invalide." });
    const abs = path.join(imagesDir, name);
    const stat = await fs.promises.stat(abs).catch(() => null);
    if (!stat?.isFile()) return reply.code(404).send({ error: 'Image introuvable.' });
    reply
      .header('Content-Type', 'image/jpeg')
      .header('Content-Length', String(stat.size))
      .header('Cache-Control', 'private, max-age=2592000');
    return reply.send(fs.createReadStream(abs));
  });
}
