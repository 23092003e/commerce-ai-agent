import Fastify, { type FastifyInstance } from 'fastify';
import {
  MetaWebhookPayloadSchema,
  verifyMetaSignature
} from '@fanpage/meta';
import { z } from 'zod';
import type { WebhookIngestion } from './services/webhook-ingestion.js';

const VerificationQuerySchema = z.object({
  'hub.mode': z.literal('subscribe'),
  'hub.verify_token': z.string(),
  'hub.challenge': z.string()
});

export interface ApiConfig {
  metaAppSecret: string;
  metaVerifyToken: string;
}

export interface BuildAppOptions {
  config: ApiConfig;
  ingestion?: WebhookIngestion;
  readiness?: { check(): Promise<void> };
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: false });

  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_request, body, done) => {
      done(null, body);
    }
  );

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async (_request, reply) => {
    try {
      await options.readiness?.check();
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'not_ready' });
    }
  });

  app.get('/webhooks/meta', async (request, reply) => {
    const query = VerificationQuerySchema.safeParse(request.query);
    if (
      !query.success ||
      query.data['hub.verify_token'] !== options.config.metaVerifyToken
    ) {
      return reply.code(403).send({ error: 'verification_failed' });
    }

    return reply.type('text/plain').send(query.data['hub.challenge']);
  });

  app.post('/webhooks/meta', async (request, reply) => {
    const rawBody = request.body;
    if (!Buffer.isBuffer(rawBody)) {
      return reply.code(400).send({ error: 'raw_body_required' });
    }

    const signature = request.headers['x-hub-signature-256'];
    if (
      typeof signature !== 'string' ||
      !verifyMetaSignature(rawBody, signature, options.config.metaAppSecret)
    ) {
      return reply.code(401).send({ error: 'invalid_signature' });
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8')) as unknown;
    } catch {
      return reply.code(400).send({ error: 'invalid_json' });
    }

    const payload = MetaWebhookPayloadSchema.safeParse(json);
    if (!payload.success) {
      return reply.code(400).send({ error: 'invalid_payload' });
    }

    const accepted = options.ingestion
      ? await options.ingestion.ingest(payload.data)
      : payload.data.entry.reduce(
          (count, entry) => count + entry.messaging.length,
          0
        );

    return reply.code(200).send({ accepted });
  });

  return app;
}
