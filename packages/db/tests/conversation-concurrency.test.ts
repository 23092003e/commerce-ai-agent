import { describe, expect, it } from 'vitest';
import { InMemoryCommerceRepository } from '../src/index.js';

function webhookEvent(messageId: string, text: string, timestamp: number) {
  return {
    externalEventKey: `meta:message:${messageId}`,
    metaPageId: 'page-1',
    conversationKey: 'meta:page-1:customer-1',
    eventTimestamp: timestamp,
    rawPayload: {
      pageId: 'page-1',
      event: {
        sender: { id: 'customer-1' },
        recipient: { id: 'page-1' },
        timestamp,
        message: { mid: messageId, text }
      }
    }
  };
}

async function persistMessage(
  repository: InMemoryCommerceRepository,
  messageId: string,
  text: string,
  timestamp: number
) {
  const event = webhookEvent(messageId, text, timestamp);
  await repository.storeWebhookEvent(event);
  await repository.markWebhookEventQueued(event.externalEventKey);
  await repository.persistInboundMessage({
    eventKey: event.externalEventKey,
    metaPageId: event.metaPageId,
    metaPsid: 'customer-1',
    metaMessageId: messageId,
    text,
    timestamp,
    payload: event.rawPayload
  });
}

async function requireConversation(repository: InMemoryCommerceRepository) {
  const conversation = await repository.findOpenConversationByIdentity(
    'page-1',
    'customer-1'
  );
  if (!conversation) throw new Error('Expected an open conversation');
  return conversation;
}

describe('conversation optimistic concurrency', () => {
  it('allows only one control-mode update for the same expected version', async () => {
    const repository = new InMemoryCommerceRepository();
    await persistMessage(repository, 'message-1', 'hello', 1_000);
    const initial = await requireConversation(repository);

    const results = await Promise.all([
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

    expect(results.map((result) => result.type).sort()).toEqual([
      'conflict',
      'updated'
    ]);
    const final = await repository.findOpenConversationByIdentity(
      'page-1',
      'customer-1'
    );
    expect(final?.version).toBe(initial.version + 1);
  });

  it('keeps human control authoritative while persisting new inbound messages', async () => {
    const repository = new InMemoryCommerceRepository();
    await persistMessage(repository, 'message-1', 'human please', 1_000);
    const initial = await requireConversation(repository);
    await repository.updateConversationControlMode({
      conversationId: initial.id,
      expectedVersion: initial.version,
      controlMode: 'human'
    });

    await persistMessage(repository, 'message-2', 'are you there?', 2_000);

    const final = await repository.findOpenConversationByIdentity(
      'page-1',
      'customer-1'
    );
    expect(final?.controlMode).toBe('human');
    expect(repository.snapshot().messages).toHaveLength(2);
  });
});

describe('ordered conversation event claims', () => {
  it('defers a newer event until an older queued event is terminal', async () => {
    const repository = new InMemoryCommerceRepository();
    const newer = webhookEvent('message-newer', 'newer', 2_000);
    const older = webhookEvent('message-older', 'older', 1_000);
    await repository.storeWebhookEvent(newer);
    await repository.markWebhookEventQueued(newer.externalEventKey);
    await repository.storeWebhookEvent(older);
    await repository.markWebhookEventQueued(older.externalEventKey);

    await expect(
      repository.claimWebhookEventForProcessing(newer.externalEventKey)
    ).resolves.toMatchObject({ type: 'deferred' });
    await expect(
      repository.claimWebhookEventForProcessing(older.externalEventKey)
    ).resolves.toMatchObject({ type: 'claimed' });
    await repository.markWebhookEventIgnored(older.externalEventKey);
    await expect(
      repository.claimWebhookEventForProcessing(newer.externalEventKey)
    ).resolves.toMatchObject({ type: 'claimed' });
  });
});
