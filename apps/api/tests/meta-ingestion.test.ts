import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { InMemoryCommerceRepository } from '@fanpage/db';
import { InMemoryEventJobQueue } from '@fanpage/queue';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createWebhookIngestionService } from '../src/services/webhook-ingestion.js';
import { InboundMessageWorker } from '../src/workers/inbound-message-worker.js';

const config = {
  metaAppSecret: 'test-app-secret',
  metaVerifyToken: 'test-verify-token'
};

let firstFixture: string;
const apps: Array<ReturnType<typeof buildApp>> = [];

beforeAll(async () => {
  firstFixture = await readFile(
    fileURLToPath(new URL('./fixtures/text-message.json', import.meta.url)),
    'utf8'
  );
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

function createHarness() {
  const repository = new InMemoryCommerceRepository();
  const queue = new InMemoryEventJobQueue();
  const ingestion = createWebhookIngestionService({ repository, queue });
  const worker = new InboundMessageWorker(repository);
  const app = buildApp({ config, ingestion });
  apps.push(app);

  return { app, queue, repository, worker };
}

function sign(payload: string): string {
  return `sha256=${createHmac('sha256', config.metaAppSecret)
    .update(payload)
    .digest('hex')}`;
}

async function postFixture(app: ReturnType<typeof buildApp>, payload: string) {
  return app.inject({
    method: 'POST',
    url: '/webhooks/meta',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': sign(payload)
    },
    payload
  });
}

async function processNext(
  queue: InMemoryEventJobQueue,
  worker: InboundMessageWorker
) {
  const eventKey = queue.take();
  if (!eventKey) throw new Error('Expected an enqueued event');
  await worker.process(eventKey);
  return eventKey;
}

describe('Meta webhook ingestion pipeline', () => {
  it('rejects a signed but invalid external payload safely', async () => {
    const { app, repository } = createHarness();
    const payload = JSON.stringify({ object: 'not-a-page', entry: [] });

    const response = await postFixture(app, payload);

    expect(response.statusCode).toBe(400);
    expect(repository.snapshot().webhookEvents).toHaveLength(0);
  });

  it('stores and processes a duplicate Meta event only once', async () => {
    const { app, queue, repository, worker } = createHarness();

    expect((await postFixture(app, firstFixture)).statusCode).toBe(200);
    expect((await postFixture(app, firstFixture)).statusCode).toBe(200);
    await processNext(queue, worker);

    const snapshot = repository.snapshot();
    expect(snapshot.webhookEvents).toHaveLength(1);
    expect(snapshot.messages).toHaveLength(1);
  });

  it('creates a customer, conversation, and inbound text message', async () => {
    const { app, queue, repository, worker } = createHarness();

    await postFixture(app, firstFixture);
    await processNext(queue, worker);

    const snapshot = repository.snapshot();
    expect(snapshot.pages).toHaveLength(1);
    expect(snapshot.customers).toHaveLength(1);
    expect(snapshot.conversations).toHaveLength(1);
    expect(snapshot.messages).toMatchObject([
      {
        metaMessageId: 'message-001',
        direction: 'inbound',
        senderType: 'customer',
        text: 'Mình muốn xem sản phẩm'
      }
    ]);
  });

  it('reuses the same customer and open conversation for a second message', async () => {
    const { app, queue, repository, worker } = createHarness();
    const secondFixture = firstFixture
      .replace('message-001', 'message-002')
      .replace('1735689600123', '1735689601123')
      .replace('Mình muốn xem sản phẩm', 'Có mẫu nào dưới 500k?');

    await postFixture(app, firstFixture);
    await processNext(queue, worker);
    await postFixture(app, secondFixture);
    await processNext(queue, worker);

    const snapshot = repository.snapshot();
    expect(snapshot.customers).toHaveLength(1);
    expect(snapshot.conversations).toHaveLength(1);
    expect(snapshot.messages).toHaveLength(2);
  });

  it('keeps a queue retry idempotent after the event was processed', async () => {
    const { app, queue, repository, worker } = createHarness();

    await postFixture(app, firstFixture);
    const eventKey = await processNext(queue, worker);
    await worker.process(eventKey);

    const snapshot = repository.snapshot();
    expect(snapshot.messages).toHaveLength(1);
    expect(snapshot.webhookEvents[0]?.processingState).toBe('processed');
  });
});
