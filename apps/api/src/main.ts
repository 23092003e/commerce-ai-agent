import { loadConfig } from '@fanpage/config';
import {
  PostgresAgentRunRepository,
  PostgresCartRepository,
  PostgresCatalogRepository,
  PostgresCommerceRepository,
  PostgresHandoverRepository,
  PostgresKnowledgeRepository
} from '@fanpage/db';
import {
  createCartService,
  createCatalogService,
  createDeterministicEmbeddingProvider,
  createKnowledgeService,
  createOpenAiDecisionProvider,
  SALES_SYSTEM_PROMPT_VERSION,
  type StructuredDecisionProvider
} from '@fanpage/domain';
import { createLogger } from '@fanpage/observability';
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

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const repository = new PostgresCommerceRepository(config.DATABASE_URL);
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
const handoverRepository = new PostgresHandoverRepository(config.DATABASE_URL);
const agentRunRepository = new PostgresAgentRunRepository(config.DATABASE_URL);
const catalog = createCatalogService(catalogRepository);
const knowledge = createKnowledgeService(
  knowledgeRepository,
  createDeterministicEmbeddingProvider(8)
);
const cart = createCartService({ catalog, repository: cartRepository });

function createDecisionProvider(): StructuredDecisionProvider {
  if (config.AI_PROVIDER === 'fake') {
    const decision =
      config.META_ADAPTER === 'fake'
        ? {
            type: 'reply' as const,
            text: 'Đây là phản hồi kiểm thử từ sales agent.',
            evidenceChunkIds: []
          }
        : { type: 'handover' as const, reason: 'ai_provider_not_configured' };
    return {
      async decide() {
        return decision;
      }
    };
  }
  if (!config.AI_API_KEY || !config.AI_MODEL) {
    throw new Error('AI_API_KEY and AI_MODEL are required for OpenAI');
  }
  return createOpenAiDecisionProvider({
    apiKey: config.AI_API_KEY,
    model: config.AI_MODEL
  });
}

const inboundWorker = new InboundMessageWorker(
  repository,
  new AgentMessageHandler({
    provider: createDecisionProvider(),
    catalog,
    knowledge,
    cart,
    agentRuns: agentRunRepository,
    handovers: handoverRepository,
    channel: messagingChannel,
    modelProvider: config.AI_PROVIDER,
    modelName: config.AI_MODEL ?? 'fake',
    promptVersion: SALES_SYSTEM_PROMPT_VERSION
  })
);
const queueWorker = startBullMqEventWorker(config.REDIS_URL, inboundWorker);
const app = buildApp({
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
    ? { secret: config.ADMIN_AUTH_SECRET, repository }
    : { repository },
  readiness: {
    async check() {
      await Promise.all([repository.ping(), queue.ping()]);
    }
  }
});

queueWorker.on('failed', (job, error) => {
  logger.error(
    { eventKey: job?.data.eventKey, error: error.message },
    'Webhook worker job failed'
  );
});
queueWorker.on('error', (error) => {
  logger.error({ error: error.message }, 'Webhook worker error');
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down');
  await app.close();
  await queueWorker.close();
  await queue.close();
  await agentRunRepository.close();
  await handoverRepository.close();
  await cartRepository.close();
  await knowledgeRepository.close();
  await catalogRepository.close();
  await repository.close();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  logger.info({ host: config.HOST, port: config.PORT }, 'API listening');
} catch (error) {
  logger.fatal({ error }, 'API failed to start');
  await shutdown('startup_failure');
  process.exit(1);
}
