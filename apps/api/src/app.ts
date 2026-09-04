import Fastify, {
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from 'fastify';
import {
  MetaWebhookPayloadSchema,
  type MessagingChannel,
  verifyMetaSignature
} from '@fanpage/meta';
import { z } from 'zod';
import type { CommerceRepository } from '@fanpage/db';
import { isAuthorizedAdmin } from './services/admin-auth.js';
import type { WebhookIngestion } from './services/webhook-ingestion.js';

const VerificationQuerySchema = z.object({
  'hub.mode': z.literal('subscribe'),
  'hub.verify_token': z.string(),
  'hub.challenge': z.string()
});

const TestOutboundSchema = z.object({
  recipientId: z.string().min(1),
  text: z.string().min(1).max(2_000)
});

export interface ApiConfig {
  metaAppSecret: string;
  metaVerifyToken: string;
}

export interface BuildAppOptions {
  config: ApiConfig;
  ingestion?: WebhookIngestion;
  readiness?: { check(): Promise<void> };
  logger?: FastifyBaseLogger;
  messagingChannel?: MessagingChannel;
  enableTestMessagingRoutes?: boolean;
  admin?: { secret?: string; repository: CommerceRepository };
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app: FastifyInstance = options.logger
    ? Fastify({ loggerInstance: options.logger })
    : Fastify({ logger: false });

  app.setErrorHandler(
    (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
      options.logger?.error(
        {
          error: { name: error.name, message: error.message },
          method: request.method,
          url: request.url
        },
        'Unhandled API request failure'
      );
      void reply.code(500).send({ error: 'internal_error' });
    }
  );

  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_request, body, done) => {
      done(null, body);
    }
  );

  app.get('/health', async () => ({ status: 'ok' }));
  if (options.admin) {
    const admin = options.admin;
    app.post(
      '/internal/admin/conversations/:conversationId/control',
      async (request, reply) => {
        if (!isAuthorizedAdmin(request.headers.authorization, admin.secret)) {
          return reply.code(401).send({ error: 'admin_unauthorized' });
        }
        const params = z
          .object({ conversationId: z.uuid() })
          .safeParse(request.params);
        let requestBody: unknown;
        try {
          requestBody = Buffer.isBuffer(request.body)
            ? (JSON.parse(request.body.toString('utf8')) as unknown)
            : request.body;
        } catch {
          return reply.code(400).send({ error: 'invalid_admin_request' });
        }
        const body = z
          .object({
            expectedVersion: z.number().int().positive(),
            controlMode: z.enum(['ai', 'human', 'paused'])
          })
          .safeParse(requestBody);
        if (!params.success || !body.success)
          return reply.code(400).send({ error: 'invalid_admin_request' });
        const result = await admin.repository.updateConversationControlMode({
          conversationId: params.data.conversationId,
          ...body.data
        });
        return reply
          .code(
            result.type === 'updated'
              ? 200
              : result.type === 'conflict'
                ? 409
                : 404
          )
          .send(result);
      }
    );
  }
  app.get('/ready', async (_request, reply) => {
    try {
      await options.readiness?.check();
      return { status: 'ready' };
    } catch (error) {
      options.logger?.error(
        {
          error: {
            name: error instanceof Error ? error.name : 'UnknownError',
            message:
              error instanceof Error
                ? error.message
                : 'Unknown readiness failure'
          }
        },
        'Dependency readiness check failed'
      );
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

  if (options.enableTestMessagingRoutes && options.messagingChannel) {
    app.post('/internal/test/meta/outbound', async (request, reply) => {
      const rawBody = request.body;
      if (!Buffer.isBuffer(rawBody)) {
        return reply.code(400).send({ error: 'raw_body_required' });
      }

      let json: unknown;
      try {
        json = JSON.parse(rawBody.toString('utf8')) as unknown;
      } catch {
        return reply.code(400).send({ error: 'invalid_json' });
      }

      const input = TestOutboundSchema.safeParse(json);
      if (!input.success) {
        return reply.code(400).send({ error: 'invalid_payload' });
      }

      return options.messagingChannel?.sendText(input.data);
    });

    app.get('/internal/test/meta/outbound', async () => {
      const channel = options.messagingChannel as MessagingChannel & {
        getCapturedMessages?: () => readonly unknown[];
      };
      return { messages: channel.getCapturedMessages?.() ?? [] };
    });
  }

  return app;
}
