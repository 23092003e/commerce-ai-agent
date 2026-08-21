import { loadConfig } from '@fanpage/config';
import { PostgresCommerceRepository } from '@fanpage/db';
import { createLogger } from '@fanpage/observability';
import {
  FakeMessagingChannel,
  MetaGraphMessagingChannel,
  type MessagingChannel
} from '@fanpage/meta';
import { BullMqEventJobQueue, startBullMqEventWorker } from '@fanpage/queue';
import { buildApp } from './app.js';
import { createWebhookIngestionService } from './services/webhook-ingestion.js';
import { InboundMessageWorker } from './workers/inbound-message-worker.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const repository = new PostgresCommerceRepository(config.DATABASE_URL);
const queue = new BullMqEventJobQueue(config.REDIS_URL);
const inboundWorker = new InboundMessageWorker(repository);
const queueWorker = startBullMqEventWorker(config.REDIS_URL, inboundWorker);
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

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down');
  await app.close();
  await queueWorker.close();
  await queue.close();
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
