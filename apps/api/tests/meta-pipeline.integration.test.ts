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
  attempts: 2,
  backoffDelayMs: 500
});
const inboundWorker = new InboundMessageWorker(repository);
let forcedFailureEventKey: string | null = null;
let forcedFailuresRemaining = 0;
let heldEventKey: string | null = null;
let heldEventEntered: (() => void) | null = null;
let heldEventRelease: Promise<void> | null = null;
const handlerCallsByEvent = new Map<string, number>();
const worker = startBullMqEventWorker(redisUrl, {
  async process(eventKey) {
    handlerCallsByEvent.set(
      eventKey,
      (handlerCallsByEvent.get(eventKey) ?? 0) + 1
    );
    if (forcedFailuresRemaining > 0 && eventKey === forcedFailureEventKey) {
      forcedFailuresRemaining -= 1;
      throw new Error('forced integration failure');
    }
    if (eventKey === heldEventKey && heldEventRelease) {
      const claim = await repository.claimWebhookEventForProcessing(eventKey);
      if (claim.type === 'claimed') {
        heldEventEntered?.();
        await heldEventRelease;
        heldEventKey = null;
        heldEventEntered = null;
        heldEventRelease = null;
      }
    }
    return inboundWorker.process(eventKey);
  },
  async onFinalFailure(eventKey, error) {
    await inboundWorker.onFinalFailure(eventKey, error);
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

async function waitForHandlerCalls(
  eventKey: string,
  expectedCalls: number
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((handlerCallsByEvent.get(eventKey) ?? 0) >= expectedCalls) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Handler ${eventKey} did not run ${String(expectedCalls)} times`
  );
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
    forcedFailuresRemaining = 2;

    expect((await postSignedFixture(payload)).statusCode).toBe(200);
    await waitForJobState(eventKey, 'failed');
    const terminalEvent = await repository.getWebhookEvent(eventKey);
    expect(terminalEvent?.processingState).toBe('failed');
    const beforeRedelivery = await pool.query<{ count: string }>(
      'SELECT count(*) FROM messages WHERE meta_message_id = $1',
      [messageId]
    );
    expect(Number(beforeRedelivery.rows[0]?.count)).toBe(0);

    expect((await postSignedFixture(payload)).statusCode).toBe(200);
    expect(await waitForMessage(messageId)).toBe(1);
  });

  it('preserves ordering while an older same-conversation job retries', async () => {
    const fixture = await readFile(
      fileURLToPath(new URL('./fixtures/text-message.json', import.meta.url)),
      'utf8'
    );
    const suffix = randomUUID();
    const customerId = `concurrent-customer-${suffix}`;
    const olderMessageId = `concurrent-older-${suffix}`;
    const newerMessageId = `concurrent-newer-${suffix}`;
    const olderTimestamp = 1_735_689_600_123;
    const newerTimestamp = 1_735_689_700_123;
    const olderEventKey = `meta:message:${olderMessageId}`;
    const newerEventKey = `meta:message:${newerMessageId}`;
    const olderPayload = fixture
      .replace('message-001', olderMessageId)
      .replace('customer-456', customerId)
      .replace('1735689600123', String(olderTimestamp));
    const newerPayload = fixture
      .replace('message-001', newerMessageId)
      .replace('customer-456', customerId)
      .replace('1735689600123', String(newerTimestamp));
    forcedFailureEventKey = olderEventKey;
    forcedFailuresRemaining = 1;
    heldEventKey = olderEventKey;
    const olderRetryEntered = new Promise<void>((resolve) => {
      heldEventEntered = resolve;
    });
    let releaseOlder: () => void = () => undefined;
    heldEventRelease = new Promise<void>((resolve) => {
      releaseOlder = resolve;
    });

    try {
      expect((await postSignedFixture(olderPayload)).statusCode).toBe(200);
      await waitForJobState(olderEventKey, 'delayed');
      const retrying = await repository.getWebhookEvent(olderEventKey);
      expect(retrying?.processingState).toBe('queued');
      await olderRetryEntered;

      expect((await postSignedFixture(newerPayload)).statusCode).toBe(200);
      await waitForHandlerCalls(newerEventKey, 2);
      const deferredJob = await queue.getJobDetails(newerEventKey);
      expect(deferredJob?.attemptsMade).toBe(0);
      expect(['active', 'delayed']).toContain(deferredJob?.state);
    } finally {
      releaseOlder();
    }

    expect(await waitForMessage(olderMessageId)).toBe(1);
    expect(await waitForMessage(newerMessageId)).toBe(1);

    const order = await pool.query<{
      meta_message_id: string;
      created_at: Date;
    }>(
      `SELECT meta_message_id, created_at
       FROM messages
       WHERE meta_message_id IN ($1, $2)
       ORDER BY created_at, meta_message_id`,
      [olderMessageId, newerMessageId]
    );
    expect(order.rows.map((row) => row.meta_message_id)).toEqual([
      olderMessageId,
      newerMessageId
    ]);
  });

  it('allows exactly one concurrent control update for a conversation version', async () => {
    const fixture = await readFile(
      fileURLToPath(new URL('./fixtures/text-message.json', import.meta.url)),
      'utf8'
    );
    const suffix = randomUUID();
    const messageId = `control-${suffix}`;
    const customerId = `control-customer-${suffix}`;
    const payload = fixture
      .replace('message-001', messageId)
      .replace('customer-456', customerId);

    expect((await postSignedFixture(payload)).statusCode).toBe(200);
    expect(await waitForMessage(messageId)).toBe(1);
    const initial = await repository.findOpenConversationByIdentity(
      'page-123',
      customerId
    );
    if (!initial) throw new Error('Expected an open conversation');

    const updates = await Promise.all([
      repository.updateConversationControlMode({
        conversationId: initial.id,
        expectedVersion: initial.version,
        controlMode: 'human'
      }),
      repository.updateConversationControlMode({
        conversationId: initial.id,
        expectedVersion: initial.version,
        controlMode: 'paused'
      })
    ]);

    expect(updates.map((result) => result.type).sort()).toEqual([
      'conflict',
      'updated'
    ]);
    const final = await repository.findOpenConversationByIdentity(
      'page-123',
      customerId
    );
    expect(final?.version).toBe(initial.version + 1);
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
