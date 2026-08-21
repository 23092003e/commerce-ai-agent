import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PostgresCommerceRepository, runMigrations } from '@fanpage/db';
import { BullMqEventJobQueue, startBullMqEventWorker } from '@fanpage/queue';
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
const queue = new BullMqEventJobQueue(redisUrl, {
  attempts: 1,
  backoffDelayMs: 10
});
const inboundWorker = new InboundMessageWorker(repository);
let forcedFailureEventKey: string | null = null;
let forcedFailurePending = false;
const worker = startBullMqEventWorker(redisUrl, {
  async process(eventKey) {
    if (forcedFailurePending && eventKey === forcedFailureEventKey) {
      forcedFailurePending = false;
      await repository.markWebhookEventFailed(
        eventKey,
        'forced integration failure'
      );
      throw new Error('forced integration failure');
    }
    await inboundWorker.process(eventKey);
  }
});
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

async function waitForJobState(
  eventKey: string,
  expectedState: string
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await queue.getJobState(eventKey)) === expectedState) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Job ${eventKey} did not reach state ${expectedState}`);
}

async function postSignedFixture(payload: string) {
  const signature = createHmac('sha256', appSecret)
    .update(payload)
    .digest('hex');
  return app.inject({
    method: 'POST',
    url: '/webhooks/meta',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${signature}`
    },
    payload
  });
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
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await postSignedFixture(payload);
      expect(response.statusCode).toBe(200);
    }

    expect(await waitForMessage(messageId)).toBe(1);
    const count = await pool.query<{ count: string }>(
      'SELECT count(*) FROM messages WHERE meta_message_id = $1',
      [messageId]
    );
    expect(Number(count.rows[0]?.count)).toBe(1);
  });

  it('re-enqueues an exhausted failed job when Meta redelivers it', async () => {
    const fixture = await readFile(
      fileURLToPath(new URL('./fixtures/text-message.json', import.meta.url)),
      'utf8'
    );
    const suffix = randomUUID();
    const messageId = `retry-${suffix}`;
    const eventKey = `meta:message:${messageId}`;
    const payload = fixture
      .replace('message-001', messageId)
      .replace('customer-456', `customer-${suffix}`);
    forcedFailureEventKey = eventKey;
    forcedFailurePending = true;

    expect((await postSignedFixture(payload)).statusCode).toBe(200);
    await waitForJobState(eventKey, 'failed');
    const beforeRedelivery = await pool.query<{ count: string }>(
      'SELECT count(*) FROM messages WHERE meta_message_id = $1',
      [messageId]
    );
    expect(Number(beforeRedelivery.rows[0]?.count)).toBe(0);

    expect((await postSignedFixture(payload)).statusCode).toBe(200);
    expect(await waitForMessage(messageId)).toBe(1);
  });

  it('does not move conversation time backwards for an older late event', async () => {
    const fixture = await readFile(
      fileURLToPath(new URL('./fixtures/text-message.json', import.meta.url)),
      'utf8'
    );
    const suffix = randomUUID();
    const customerId = `ordered-customer-${suffix}`;
    const newerMessageId = `newer-${suffix}`;
    const olderMessageId = `older-${suffix}`;
    const newerTimestamp = 1_735_689_700_123;
    const olderTimestamp = 1_735_689_600_123;
    const newerPayload = fixture
      .replace('message-001', newerMessageId)
      .replace('customer-456', customerId)
      .replace('1735689600123', String(newerTimestamp));
    const olderPayload = fixture
      .replace('message-001', olderMessageId)
      .replace('customer-456', customerId)
      .replace('1735689600123', String(olderTimestamp));

    await postSignedFixture(newerPayload);
    expect(await waitForMessage(newerMessageId)).toBe(1);
    await postSignedFixture(olderPayload);
    expect(await waitForMessage(olderMessageId)).toBe(1);

    const result = await pool.query<{ last_customer_message_at: Date }>(
      `SELECT c.last_customer_message_at
       FROM conversations c
       JOIN customers cu ON cu.id = c.customer_id
       WHERE cu.meta_psid = $1 AND c.status = 'open'`,
      [customerId]
    );
    expect(result.rows[0]?.last_customer_message_at.getTime()).toBe(
      newerTimestamp
    );
  });
});
