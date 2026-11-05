import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isAuthorizedAdmin } from './admin-auth.js';

export interface AdminSessionOptions {
  production?: boolean;
  allowedOrigins?: string[];
  baseUrl?: string | undefined;
  legacyBearerEnabled?: boolean;
  now?: () => number;
}
const lifetime = 8 * 60 * 60 * 1000;
const loginSchema = z.object({ secret: z.string().min(1).max(1024) }).strict();
const payloadSchema = z
  .object({
    v: z.literal(1),
    actor: z.literal('demo-admin'),
    iat: z.number(),
    exp: z.number(),
    csrf: z.string().length(48)
  })
  .strict();
function equal(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function registerAdminSession(
  app: FastifyInstance,
  secret: string | undefined,
  options: AdminSessionOptions = {}
) {
  const production =
    options.production ?? process.env.NODE_ENV === 'production';
  if (production && (!secret || secret.length < 32))
    throw new Error('Production Admin requires a 32 character secret');
  const now = options.now ?? Date.now;
  const buckets = new Map<string, { count: number; until: number }>();
  const revoked = new Map<string, number>();
  let revokedBefore = -1;
  function limited(key: string, max: number, window: number) {
    const time = now();
    for (const [id, item] of buckets)
      if (item.until <= time) buckets.delete(id);
    let item = buckets.get(key);
    if (!item) {
      if (buckets.size >= 10_000) return true;
      item = { count: 0, until: time + window };
      buckets.set(key, item);
    }
    return ++item.count > max;
  }
  function sign(value: string) {
    return createHmac('sha256', secret ?? '')
      .update(value)
      .digest('base64url');
  }
  function read(cookie: string | undefined) {
    try {
      const raw = cookie
        ?.split(';')
        .map((x) => x.trim())
        .find((x) => x.startsWith('admin_session='))
        ?.slice(14);
      if (!raw || raw.length > 2048 || !secret) return null;
      const [value, signature, extra] = raw.split('.');
      if (!value || !signature || extra || !equal(sign(value), signature))
        return null;
      const parsed = payloadSchema.safeParse(
        JSON.parse(Buffer.from(value, 'base64url').toString())
      );
      return parsed.success &&
        parsed.data.exp > now() &&
        parsed.data.iat > revokedBefore &&
        !revoked.has(parsed.data.csrf) &&
        parsed.data.iat <= now() &&
        parsed.data.exp - parsed.data.iat === lifetime
        ? parsed.data
        : null;
    } catch {
      return null;
    }
  }
  function cookie(value: string, age: number) {
    return `admin_session=${value}; Path=/internal; HttpOnly; SameSite=Strict; Max-Age=${String(age)}${production ? '; Secure' : ''}`;
  }
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/admin' || request.url.startsWith('/admin/')) {
      reply
        .header('x-content-type-options', 'nosniff')
        .header('x-frame-options', 'DENY')
        .header(
          'content-security-policy',
          "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'"
        );
    }
    if (!request.url.split('?')[0]?.startsWith('/internal/admin')) return;
    reply
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .header('x-frame-options', 'DENY');
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const origin = request.headers.origin;
    const allowed = options.allowedOrigins ?? [];
    const sameOrigin = options.baseUrl
      ? new URL(options.baseUrl).origin
      : `${production ? 'https' : request.protocol}://${request.headers.host ?? ''}`;
    if (origin && origin !== sameOrigin && !allowed.includes(origin))
      return reply.code(403).send({ error: 'admin_origin_forbidden' });
    if (
      request.url.split('?')[0] === '/internal/admin/session' &&
      request.method === 'POST'
    ) {
      if (limited(`login:${request.ip}`, 5, 15 * 60_000))
        return reply.code(429).send({ error: 'admin_rate_limited' });
      return;
    }
    const session = read(request.headers.cookie);
    const legacy =
      !production &&
      options.legacyBearerEnabled === true &&
      isAuthorizedAdmin(request.headers.authorization, secret);
    if (!session && !legacy)
      return reply.code(401).send({ error: 'admin_unauthorized' });
    if (
      mutation &&
      !legacy &&
      (!session ||
        typeof request.headers['x-csrf-token'] !== 'string' ||
        !equal(request.headers['x-csrf-token'], session.csrf))
    )
      return reply.code(403).send({ error: 'admin_csrf_forbidden' });
    if (
      limited(
        `${mutation ? 'write' : 'read'}:${session?.actor ?? 'legacy'}:${request.ip}`,
        mutation ? 30 : 120,
        60_000
      )
    )
      return reply.code(429).send({ error: 'admin_rate_limited' });
  });
  app.post('/internal/admin/session', async (request, reply) => {
    let body: unknown;
    try {
      body = Buffer.isBuffer(request.body)
        ? JSON.parse(request.body.toString())
        : request.body;
    } catch {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const input = loginSchema.safeParse(body);
    if (!input.success)
      return reply.code(400).send({ error: 'invalid_request' });
    if (!secret || !equal(input.data.secret, secret))
      return reply.code(401).send({ error: 'admin_unauthorized' });
    const payload = {
      v: 1,
      actor: 'demo-admin',
      iat: now(),
      exp: now() + lifetime,
      csrf: randomBytes(24).toString('hex')
    };
    const value = Buffer.from(JSON.stringify(payload)).toString('base64url');
    reply.header(
      'set-cookie',
      cookie(`${value}.${sign(value)}`, lifetime / 1000)
    );
    return {
      actor: payload.actor,
      csrfToken: payload.csrf,
      expiresAt: payload.exp
    };
  });
  app.get('/internal/admin/session', async (request) => {
    const session = read(request.headers.cookie);
    return {
      actor: session?.actor,
      csrfToken: session?.csrf,
      expiresAt: session?.exp
    };
  });
  app.delete('/internal/admin/session', async (request, reply) => {
    const session = read(request.headers.cookie);
    for (const [nonce, expires] of revoked)
      if (expires <= now()) revoked.delete(nonce);
    if (session) {
      if (revoked.size >= 10_000) {
        revokedBefore = now();
        revoked.clear();
      } else revoked.set(session.csrf, session.exp);
    }
    return reply.header('set-cookie', cookie('', 0)).code(204).send();
  });
  return {
    isAuthenticated: (cookieHeader: string | undefined) =>
      Boolean(read(cookieHeader))
  };
}
