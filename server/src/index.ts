import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import { config, validateConfig } from './config.js';
import { detectFfmpeg, transcodeAvailable } from './lib/ffmpeg.js';
import { Scanner } from './lib/scanner.js';
import { CatalogStore } from './lib/store.js';
import { tmdbEnabled } from './lib/tmdb.js';
import { authRoutes, COOKIE_NAME } from './routes/auth.js';
import { catalogRoutes } from './routes/catalog.js';
import { imageRoutes } from './routes/images.js';
import { streamRoutes } from './routes/stream.js';

const configErrors = validateConfig('server');
if (configErrors.length > 0) {
  console.error(`[Alex Prime] Configuration invalide (.env) :\n - ${configErrors.join('\n - ')}`);
  process.exit(1);
}

const store = new CatalogStore(config.dataDir);
await store.load();
if (!store.data.baselineAt && store.baselineAt()) await store.save();
const scanner = new Scanner(store);

const app = Fastify({
  logger: { level: config.logLevel },
  trustProxy: config.trustProxy,
  bodyLimit: 64 * 1024
});

await app.register(cors, { origin: config.corsOrigin.length > 0 ? config.corsOrigin : false, credentials: true });
await app.register(cookie);
await app.register(jwt, {
  secret: config.jwtSecret,
  cookie: { cookieName: COOKIE_NAME, signed: false },
  sign: { expiresIn: `${config.jwtExpiresSeconds}s` }
});

const PUBLIC_ROUTES = new Set(['/api/health', '/api/auth/login', '/api/auth/logout']);

app.addHook('onRequest', async (request, reply) => {
  const pathname = request.url.split('?')[0];
  if (!pathname.startsWith('/api/') || PUBLIC_ROUTES.has(pathname) || request.method === 'OPTIONS') return;
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'Session expirée ou absente.' });
  }
});

app.addHook('onSend', async (_request, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'SAMEORIGIN');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  return payload;
});

app.get('/api/health', async () => ({
  name: 'Alex Prime',
  status: 'ok',
  mediaReachable: fs.existsSync(config.mediaPath),
  tmdb: tmdbEnabled(),
  transcode: transcodeAvailable()
}));

authRoutes(app);
catalogRoutes(app, { store, scanner });
imageRoutes(app);
streamRoutes(app, store);

if (fs.existsSync(path.join(config.clientDist, 'index.html'))) {
  await app.register(fastifyStatic, {
    root: config.clientDist,
    prefix: '/',
    maxAge: '7d',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html') || filePath.endsWith('.webmanifest')) res.setHeader('Cache-Control', 'no-cache');
    }
  });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Route inconnue.' });
    return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
  });
} else {
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Route inconnue.' });
    return reply.code(404).type('text/plain; charset=utf-8').send('Alex Prime : interface non compilée (npm run build) ou utilisez Vite en dev.');
  });
}

await detectFfmpeg();
await app.listen({ port: config.port, host: config.host });

app.log.info(
  `Alex Prime prêt sur http://localhost:${config.port} · médias : ${config.mediaPath} · TMDB : ${
    tmdbEnabled() ? 'actif' : 'désactivé'
  } · FFmpeg : ${transcodeAvailable() ? 'actif' : 'inactif'}`
);

if (config.scanOnStart) scanner.start();
if (config.scanIntervalMinutes > 0) {
  setInterval(() => {
    scanner.start();
  }, config.scanIntervalMinutes * 60 * 1000).unref();
}

const shutdown = async (signal: string): Promise<void> => {
  app.log.info(`${signal} reçu, arrêt d'Alex Prime…`);
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
