import { describe, expect, it } from 'vitest';
import { InMemoryCommerceRepository } from '../src/in-memory.js';

describe('durable turn lifecycle', () => {
  it('persists inbound once without completing the event and resumes the same message', async () => {
    const repository = new InMemoryCommerceRepository();
    await repository.storeWebhookEvent({
      externalEventKey: 'event',
      metaPageId: 'page',
      conversationKey: 'page:customer',
      rawPayload: {},
      eventTimestamp: 1
    });
    await repository.claimWebhookEventForProcessing('event');
    const input = {
      eventKey: 'event',
      metaPageId: 'page',
      metaPsid: 'customer',
      metaMessageId: 'message',
      text: 'hello',
      timestamp: 1,
      payload: {}
    };
    const first = await repository.persistInboundMessage(input);
    expect((await repository.getWebhookEvent('event'))?.processingState).toBe(
      'processing'
    );
    expect(await repository.persistInboundMessage(input)).toEqual(first);
    await repository.markWebhookEventProcessed('event');
    expect((await repository.getWebhookEvent('event'))?.processingState).toBe(
      'processed'
    );
    expect(repository.snapshot().messages).toHaveLength(1);
  });

  it('serializes a key, permits different keys, and releases after failure', async () => {
    const repository = new InMemoryCommerceRepository();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered: string[] = [];
    const first = repository.withConversationLease('a', async () => {
      entered.push('first');
      await held;
      throw new Error('expected');
    });
    const failure = first.catch(() => undefined);
    const second = repository.withConversationLease('a', async () => {
      entered.push('second');
    });
    await repository.withConversationLease('b', async () => {
      entered.push('other');
    });
    expect(entered).toEqual(['first', 'other']);
    release();
    await Promise.all([failure, second]);
    expect(entered).toEqual(['first', 'other', 'second']);
  });
});
