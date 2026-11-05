import { loadConfig } from '@fanpage/config';
import {
  PostgresAgentRunRepository,
  PostgresConversationContextRepository,
  PostgresConversationSummaryRepository,
  PostgresOutboundMessageRepository,
  PostgresAdminRepository,
  PostgresCartRepository,
  PostgresCatalogRepository,
  PostgresCheckoutDraftRepository,
  PostgresCommerceRepository,
  PostgresHandoverRepository,
  PostgresKnowledgeRepository,
  PostgresOrderRepository
} from '@fanpage/db';
import {
  createCartService,
  createCatalogService,
  createCheckoutFlow,
  createCheckoutOrderConfirmationService,
  createDeterministicEmbeddingProvider,
  createOpenAiEmbeddingProvider,
  createKnowledgeService,
  createOpenAiDecisionProvider,
  createOrderService,
  SALES_SYSTEM_PROMPT_VERSION,
  type StructuredDecisionProvider
} from '@fanpage/domain';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createLogger, createOperationalMetrics } from '@fanpage/observability';
import {
  FakeMessagingChannel,
  MetaGraphMessagingChannel,
  type MessagingChannel
} from '@fanpage/meta';
import { BullMqEventJobQueue, startBullMqEventWorker } from '@fanpage/queue';
import { buildApp } from './app.js';
import { createWebhookIngestionService } from './services/webhook-ingestion.js';
import { AgentMessageHandler } from './workers/agent-message-handler.js';
import { InboundMessageWorker } from './workers/inbound-message-worker.js';
import { createHumanReplyPacer } from './workers/reply-pacer.js';
import { createFakeDecisionProvider } from './services/fake-decision.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const metrics = createOperationalMetrics(logger);
const repository = new PostgresCommerceRepository(config.DATABASE_URL);
const adminRepository = new PostgresAdminRepository(config.DATABASE_URL);
const queue = new BullMqEventJobQueue(config.REDIS_URL);
const ingestion = createWebhookIngestionService({ repository, queue });
function createMessagingChannel(): MessagingChannel {
  if (config.META_ADAPTER === 'fake') return new FakeMessagingChannel();
  const accessToken = config.META_PAGE_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('META_PAGE_ACCESS_TOKEN is required for graph adapter');
  }
  return new MetaGraphMessagingChannel({
    accessToken,
    apiVersion: config.META_GRAPH_API_VERSION
  });
}

const messagingChannel = createMessagingChannel();
const catalogRepository = new PostgresCatalogRepository(config.DATABASE_URL);
const knowledgeRepository = new PostgresKnowledgeRepository(
  config.DATABASE_URL
);
const cartRepository = new PostgresCartRepository(config.DATABASE_URL);
const checkoutDraftRepository = new PostgresCheckoutDraftRepository(
  config.DATABASE_URL
);
const orderRepository = new PostgresOrderRepository(config.DATABASE_URL);
const handoverRepository = new PostgresHandoverRepository(config.DATABASE_URL);
const agentRunRepository = new PostgresAgentRunRepository(config.DATABASE_URL);
const outboundRepository = new PostgresOutboundMessageRepository(
  config.DATABASE_URL
);
const contextRepository = new PostgresConversationContextRepository(
  config.DATABASE_URL
);
const summaryRepository = new PostgresConversationSummaryRepository(
  config.DATABASE_URL
);
const catalog = createCatalogService(catalogRepository);
const knowledge = createKnowledgeService(
  knowledgeRepository,
  config.EMBEDDING_PROVIDER === 'openai-compatible'
    ? createOpenAiEmbeddingProvider({
        apiKey: config.EMBEDDING_API_KEY ?? '',
        model: config.EMBEDDING_MODEL ?? '',
        baseUrl: config.EMBEDDING_BASE_URL ?? '',
        dimensions: config.EMBEDDING_DIMENSIONS
      })
    : createDeterministicEmbeddingProvider(config.EMBEDDING_DIMENSIONS)
);
const cart = createCartService({ catalog, repository: cartRepository });
const checkout = createCheckoutFlow(checkoutDraftRepository);
const checkoutOrderConfirmation = createCheckoutOrderConfirmationService({
  confirmationSecret: createHash('sha256')
    .update(config.META_APP_SECRET)
    .digest('hex'),
  confirmations: checkoutDraftRepository,
  orders: createOrderService({
    confirmationSecret: createHash('sha256')
      .update(config.META_APP_SECRET)
      .digest('hex'),
    repository: orderRepository
  })
});
const replyPacer = createHumanReplyPacer({
  enabled: config.HUMAN_REPLY_DELAY_ENABLED,
  minDelayMs: config.HUMAN_REPLY_DELAY_MIN_MS,
  maxDelayMs: config.HUMAN_REPLY_DELAY_MAX_MS,
  charactersPerSecond: config.HUMAN_REPLY_TYPING_CHARS_PER_SECOND
});

function createDecisionProvider(): StructuredDecisionProvider {
  if (config.AI_PROVIDER === 'fake') {
    return createFakeDecisionProvider(config.META_ADAPTER);
  }
  if (!config.AI_API_KEY || !config.AI_MODEL) {
    throw new Error('AI_API_KEY and AI_MODEL are required for the AI provider');
  }
  return createOpenAiDecisionProvider({
    apiKey: config.AI_API_KEY,
    model: config.AI_MODEL,
    ...(config.AI_PROVIDER === 'openrouter'
      ? { baseUrl: 'https://openrouter.ai/api/v1' }
      : {})
  });
}

const inboundWorker = new InboundMessageWorker(
  repository,
  new AgentMessageHandler({
    provider: createDecisionProvider(),
    catalog,
    knowledge,
    cart,
    checkout,
    checkoutOrderConfirmation,
    agentRuns: agentRunRepository,
    outbound: outboundRepository,
    contextRepository,
    summaryRepository,
    repository,
    handovers: handoverRepository,
    channel: messagingChannel,
    modelProvider: config.AI_PROVIDER,
    modelName: config.AI_MODEL ?? 'fake',
    promptVersion: SALES_SYSTEM_PROMPT_VERSION,
    replyPacer,
    logger,
    metrics
  }),
  handoverRepository,
  metrics
);
const queueWorker = startBullMqEventWorker(config.REDIS_URL, inboundWorker);
const app = buildApp({
  ...(config.METRICS_AUTH_SECRET
    ? { metricsAuthSecret: config.METRICS_AUTH_SECRET }
    : {}),
  adminAssetsDirectory: fileURLToPath(
    new URL('../../admin/dist/', import.meta.url)
  ),
  config: {
    metaAppSecret: config.META_APP_SECRET,
    metaVerifyToken: config.META_VERIFY_TOKEN
  },
  ingestion,
  logger,
  messagingChannel,
  enableTestMessagingRoutes:
    config.NODE_ENV !== 'production' && config.META_ADAPTER === 'fake',
  admin: config.ADMIN_AUTH_SECRET
    ? {
        session: {
          production: config.NODE_ENV === 'production',
          baseUrl: config.APP_BASE_URL,
          allowedOrigins:
            config.NODE_ENV === 'production'
              ? []
              : config.ADMIN_ALLOWED_ORIGINS,
          legacyBearerEnabled: config.ADMIN_LEGACY_BEARER_ENABLED
        },
        secret: config.ADMIN_AUTH_SECRET,
        repository,
        data: adminRepository,
        knowledge,
        handovers: handoverRepository
      }
    : {
        session: {
          production: config.NODE_ENV === 'production',
          baseUrl: config.APP_BASE_URL,
          allowedOrigins:
            config.NODE_ENV === 'production'
              ? []
              : config.ADMIN_ALLOWED_ORIGINS,
          legacyBearerEnabled: config.ADMIN_LEGACY_BEARER_ENABLED
        },
        repository,
        data: adminRepository,
        knowledge,
        handovers: handoverRepository
      },
  readiness: {
    async check() {
      await Promise.all([repository.ping(), queue.ping()]);
    }
  },
  metrics
});

queueWorker.on('failed', () => {
  logger.error({ code: 'webhook_job_failed' }, 'Webhook worker job failed');
});
queueWorker.on('error', () => {
  logger.error({ code: 'webhook_worker_error' }, 'Webhook worker error');
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down');
  await app.close();
  await queueWorker.close();
  await queue.close();
  await agentRunRepository.close();
  await outboundRepository.close();
  await contextRepository.close();
  await summaryRepository.close();
  await handoverRepository.close();
  await cartRepository.close();
  await checkoutDraftRepository.close();
  await orderRepository.close();
  await knowledgeRepository.close();
  await catalogRepository.close();
  await repository.close();
  await adminRepository.close();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  logger.info({ host: config.HOST, port: config.PORT }, 'API listening');
} catch {
  logger.fatal({ code: 'api_startup_failed' }, 'API failed to start');
  await shutdown('startup_failure');
  process.exit(1);
}
