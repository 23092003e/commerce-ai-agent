import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PostgresCommerceRepository, runMigrations } from '@fanpage/db';
import {
  BullMqEventJobQueue,
  startBullMqEventWorker
} from '@fanpage/queue';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createWebhookIngestionService } from '../src/services/webhook-ingestion.js';
import { InboundMessageWorker } from '../src/workers/inbound-message-worker.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:54322/fanpage_sales_agent';
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const appSecret = 'integration-app-secret';
const repository = new PostgresCommerceRepository(databaseUrl);
const queue = new BullMqEventJobQueue(redisUrl);
const worker = startBullMqEventWorker(
  redisUrl,
  new InboundMessageWorker(repository)
);
const pool = new Pool({ connectionString: databaseUrl });
const app = buildApp({
  config: {
    metaAppSecret: appSecret,
    metaVerifyToken: 'integration-verify-token'
  },
  ingestion: createWebhookIngestionService({ repository, queue })
});

beforeAll(async () => {
  await runMigrations(
    databaseUrl,
    fileURLToPath(new URL('../../../packages/db/migrations/', import.meta.url))
  );
});

afterAll(async () => {
  await app.close();
  await worker.close();
  await queue.close();
  await repository.close();
  await pool.end();
});

async function waitForMessage(messageId: string): Promise<number> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ count: string }>(
      'SELECT count(*) FROM messages WHERE meta_message_id = $1',
      [messageId]
    );
    const count = Number(result.rows[0]?.count ?? 0);
    if (count > 0) return count;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return 0;
}

describe('real Postgres and Redis webhook pipeline', () => {
  it('persists a signed fixture through BullMQ exactly once', async () => {
    const fixture = await readFile(
      fileURLToPath(new URL('./fixtures/text-message.json', import.meta.url)),
      'utf8'
    );
    const suffix = randomUUID();
    const messageId = `integration-${suffix}`;
    const payload = fixture
      .replace('message-001', messageId)
      .replace('customer-456', `customer-${suffix}`);
    const signature = createHmac('sha256', appSecret)
      .update(payload)
      .digest('hex');

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/meta',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': `sha256=${signature}`
        },
        payload
      });
      expect(response.statusCode).toBe(200);
    }

    expect(await waitForMessage(messageId)).toBe(1);
    const count = await pool.query<{ count: string }>(
      'SELECT count(*) FROM messages WHERE meta_message_id = $1',
      [messageId]
    );
    expect(Number(count.rows[0]?.count)).toBe(1);
  });
});
