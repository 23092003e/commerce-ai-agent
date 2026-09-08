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

const AdminKnowledgeIngestionSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    sourceType: z.enum(['policy', 'faq', 'guide', 'script']),
    sourceUri: z.url().max(2_048).optional(),
    sourceKey: z.string().trim().min(1).max(500).optional(),
    content: z.string().trim().min(1).max(100_000),
    topics: z.array(z.string().trim().min(1).max(100)).max(10).default([])
  })
  .strict();

export interface ApiConfig {
  metaAppSecret: string;
  metaVerifyToken: string;
}

export interface AdminOperationalData {
  listConversations(): Promise<
    Array<{
      id: string;
      customer: string | null;
      controlMode: 'ai' | 'human' | 'paused';
      lastMessage: string | null;
      version: number;
    }>
  >;
  getConversationMessages?(conversationId: string): Promise<Array<{
    id: string;
    senderType: string;
    text: string | null;
    deliveryState: string;
    createdAt: string;
  }> | null>;
  listOrders?(): Promise<
    Array<{
      id: string;
      orderNumber: string;
      customer: string | null;
      status: string;
      total: string;
      currency: string;
      createdAt: string;
    }>
  >;
  getOrderDetail?(orderId: string): Promise<{
    id: string;
    orderNumber: string;
    status: string;
    recipientName: string;
    paymentMethod: string;
    paymentStatus: string;
    total: string;
    currency: string;
    items: Array<{
      sku: string;
      name: string;
      variant: string;
      quantity: number;
      lineTotal: string;
    }>;
  } | null>;
  listProducts?(): Promise<
    Array<{
      id: string;
      name: string;
      sku: string | null;
      status: string;
      price: string;
      currency: string;
      variantCount: number;
      availableInventory: number;
    }>
  >;
  getProductDetail?(productId: string): Promise<{
    id: string;
    name: string;
    status: string;
    currency: string;
    description: string;
    variants: Array<{
      sku: string;
      title: string;
      status: string;
      price: string;
      availableInventory: number;
    }>;
  } | null>;
  listCustomers?(): Promise<
    Array<{
      id: string;
      name: string | null;
      phone: string | null;
      email: string | null;
      conversationCount: number;
    }>
  >;
  getCustomerDetail?(customerId: string): Promise<{
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    conversationCount: number;
    orderCount: number;
  } | null>;
  listKnowledgeDocuments?(): Promise<
    Array<{
      id: string;
      title: string;
      sourceType: string;
      status: string;
      topics: string[];
      updatedAt: string;
    }>
  >;
  listAgentRuns?(): Promise<
    Array<{
      id: string;
      conversationId: string;
      customer: string | null;
      model: string;
      status: string;
      outcome: string | null;
      latencyMs: number | null;
      toolCallCount: number;
      startedAt: string;
    }>
  >;
}

export interface BuildAppOptions {
  config: ApiConfig;
  ingestion?: WebhookIngestion;
  readiness?: { check(): Promise<void> };
  logger?: FastifyBaseLogger;
  messagingChannel?: MessagingChannel;
  enableTestMessagingRoutes?: boolean;
  admin?: {
    secret?: string;
    repository: CommerceRepository;
    data?: AdminOperationalData;
    knowledge?: {
      ingest(
        input: unknown
      ): Promise<
        | { type: 'created'; documentId: string }
        | { type: 'duplicate'; documentId: string }
      >;
    };
  };
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
    app.get('/internal/admin/conversations', async (request, reply) => {
      if (!isAuthorizedAdmin(request.headers.authorization, admin.secret)) {
        return reply.code(401).send({ error: 'admin_unauthorized' });
      }
      if (!admin.data) return { conversations: [] };
      return { conversations: await admin.data.listConversations() };
    });
    app.get(
      '/internal/admin/conversations/:conversationId/messages',
      async (request, reply) => {
        if (!isAuthorizedAdmin(request.headers.authorization, admin.secret)) {
          return reply.code(401).send({ error: 'admin_unauthorized' });
        }
        const params = z
          .object({ conversationId: z.uuid() })
          .safeParse(request.params);
        if (!params.success)
          return reply.code(400).send({ error: 'invalid_admin_request' });
        const messages = await admin.data?.getConversationMessages?.(
          params.data.conversationId
        );
        if (messages === undefined || messages === null)
          return reply.code(404).send({ error: 'conversation_not_found' });
        return { messages };
      }
    );
    app.get('/internal/admin/orders', async (request, reply) => {
      if (!isAuthorizedAdmin(request.headers.authorization, admin.secret)) {
        return reply.code(401).send({ error: 'admin_unauthorized' });
      }
      return { orders: (await admin.data?.listOrders?.()) ?? [] };
    });
    app.get('/internal/admin/orders/:orderId', async (request, reply) => {
      if (!isAuthorizedAdmin(request.headers.authorization, admin.secret)) {
        return reply.code(401).send({ error: 'admin_unauthorized' });
      }
      const params = z.object({ orderId: z.uuid() }).safeParse(request.params);
      if (!params.success)
        return reply.code(400).send({ error: 'invalid_admin_request' });
      const order = await admin.data?.getOrderDetail?.(params.data.orderId);
      if (!order) return reply.code(404).send({ error: 'order_not_found' });
      return { order };
    });
    app.get('/internal/admin/products', async (request, reply) => {
      if (!isAuthorizedAdmin(request.headers.authorization, admin.secret)) {
        return reply.code(401).send({ error: 'admin_unauthorized' });
      }
      return { products: (await admin.data?.listProducts?.()) ?? [] };
    });
    app.get('/internal/admin/products/:productId', async (request, reply) => {
      if (!isAuthorizedAdmin(request.headers.authorization, admin.secret)) {
        return reply.code(401).send({ error: 'admin_unauthorized' });
      }
      const params = z
        .object({ productId: z.uuid() })
        .safeParse(request.params);
      if (!params.success)
        return reply.code(400).send({ error: 'invalid_admin_request' });
      const product = await admin.data?.getProductDetail?.(
        params.data.productId
      );
      if (!product) return reply.code(404).send({ error: 'product_not_found' });
      return { product };
    });
    app.get('/internal/admin/customers', async (request, reply) => {
      if (!isAuthorizedAdmin(request.headers.authorization, admin.secret)) {
        return reply.code(401).send({ error: 'admin_unauthorized' });
      }
      return { customers: (await admin.data?.listCustomers?.()) ?? [] };
    });
    app.get('/internal/admin/customers/:customerId', async (request, reply) => {
      if (!isAuthorizedAdmin(request.headers.authorization, admin.secret))
        return reply.code(401).send({ error: 'admin_unauthorized' });
      const params = z
        .object({ customerId: z.uuid() })
        .safeParse(request.params);
      if (!params.success)
        return reply.code(400).send({ error: 'invalid_admin_request' });
      const customer = await admin.data?.getCustomerDetail?.(
        params.data.customerId
      );
      if (!customer)
        return reply.code(404).send({ error: 'customer_not_found' });
      return { customer };
    });
    app.get('/internal/admin/knowledge', async (request, reply) => {
      if (!isAuthorizedAdmin(request.headers.authorization, admin.secret)) {
        return reply.code(401).send({ error: 'admin_unauthorized' });
      }
      return {
        documents: (await admin.data?.listKnowledgeDocuments?.()) ?? []
      };
    });
    app.post('/internal/admin/knowledge', async (request, reply) => {
      if (!isAuthorizedAdmin(request.headers.authorization, admin.secret)) {
        return reply.code(401).send({ error: 'admin_unauthorized' });
      }
      if (!admin.knowledge)
        return reply.code(501).send({ error: 'knowledge_unavailable' });
      let requestBody: unknown;
      try {
        requestBody = Buffer.isBuffer(request.body)
          ? (JSON.parse(request.body.toString('utf8')) as unknown)
          : request.body;
      } catch {
        return reply.code(400).send({ error: 'invalid_knowledge_request' });
      }
      const body = AdminKnowledgeIngestionSchema.safeParse(requestBody);
      if (!body.success)
        return reply.code(400).send({ error: 'invalid_knowledge_request' });
      const result = await admin.knowledge.ingest(body.data);
      return reply.code(result.type === 'created' ? 201 : 200).send(result);
    });
    app.get('/internal/admin/agent-runs', async (request, reply) => {
      if (!isAuthorizedAdmin(request.headers.authorization, admin.secret)) {
        return reply.code(401).send({ error: 'admin_unauthorized' });
      }
      return { runs: (await admin.data?.listAgentRuns?.()) ?? [] };
    });
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
