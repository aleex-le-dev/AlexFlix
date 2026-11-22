import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import '@fastify/jwt';
import { config } from '../config.js';
import { sleep } from '../lib/utils.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string; iat: number; exp: number };
  }
}

export const COOKIE_NAME = 'alexflix_session';
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function safeEqual(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function pruneAttempts(now: number): void {
  if (attempts.size < 1000) return;
  for (const [key, entry] of attempts) if (entry.resetAt <= now) attempts.delete(key);
}

export function authRoutes(app: FastifyInstance): void {
  app.post<{ Body: { password: string } }>(
    '/api/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['password'],
          properties: { password: { type: 'string', minLength: 1, maxLength: 512 } }
        }
      }
    },
    async (request, reply) => {
      const now = Date.now();
      pruneAttempts(now);
      const key = request.ip;
      const entry = attempts.get(key);
      if (entry && entry.resetAt > now && entry.count >= MAX_ATTEMPTS) {
        const retrySeconds = Math.ceil((entry.resetAt - now) / 1000);
        reply.header('Retry-After', String(retrySeconds));
        return reply.code(429).send({ error: `Trop de tentatives. Réessayez dans ${Math.ceil(retrySeconds / 60)} min.` });
      }

      if (!safeEqual(request.body.password, config.masterPassword)) {
        attempts.set(
          key,
          entry && entry.resetAt > now ? { count: entry.count + 1, resetAt: entry.resetAt } : { count: 1, resetAt: now + WINDOW_MS }
        );
        await sleep(500);
        return reply.code(401).send({ error: 'Mot de passe incorrect.' });
      }

      attempts.delete(key);
      const token = await reply.jwtSign({ sub: 'owner' }, { expiresIn: `${config.jwtExpiresSeconds}s` });
      reply.setCookie(COOKIE_NAME, token, {
        path: '/',
        httpOnly: true,
        sameSite: 'strict',
        secure: config.cookieSecure,
        maxAge: config.jwtExpiresSeconds
      });
      return { token, expiresIn: config.jwtExpiresSeconds };
    }
  );

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (request) => ({ authenticated: true, exp: request.user.exp }));
}
