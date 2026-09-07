import {
  createScriptedDecisionProvider,
  type CartService,
  type CatalogService,
  type CheckoutFlow,
  type KnowledgeService
} from '@fanpage/domain';
import { FakeMessagingChannel } from '@fanpage/meta';
import { describe, expect, it } from 'vitest';
import { AgentMessageHandler } from '../src/workers/agent-message-handler.js';
import type { ReplyPacer } from '../src/workers/reply-pacer.js';

const conversation = {
  id: '11111111-1111-4111-8111-111111111111',
  pageId: '22222222-2222-4222-8222-222222222222',
  customerId: '33333333-3333-4333-8333-333333333333',
  status: 'open' as const,
  controlMode: 'ai' as const,
  version: 2
};

function createHarness(
  decisions: unknown[],
  options: { replyPacer?: ReplyPacer } = {}
) {
  const channel = new FakeMessagingChannel();
  const completions: string[] = [];
  const handovers: string[] = [];
  const handler = new AgentMessageHandler({
    provider: createScriptedDecisionProvider(decisions),
    catalog: {} as CatalogService,
    knowledge: {} as KnowledgeService,
    cart: {} as CartService,
    checkout: {} as CheckoutFlow,
    agentRuns: {
      async start() {
        return '44444444-4444-4444-8444-444444444444';
      },
      async recordToolCall() {},
      async complete(input) {
        completions.push(input.outcome);
      }
    },
    handovers: {
      async request(input) {
        handovers.push(input.reason);
      }
    },
    channel,
    modelProvider: 'fake',
    modelName: 'fake',
    promptVersion: 'test.v1',
    ...(options.replyPacer === undefined
      ? {}
      : { replyPacer: options.replyPacer })
  });
  return { channel, completions, handovers, handler };
}

const message = {
  messageId: '55555555-5555-4555-8555-555555555555',
  customerId: conversation.customerId,
  conversation,
  recipientId: 'customer-123',
  text: 'Xin chào',
  timestamp: Date.now()
};

describe('AgentMessageHandler', () => {
  it('sends an agent reply through the channel and records the outcome', async () => {
    const { handler, channel, completions, handovers } = createHarness([
      { type: 'reply', text: 'Chào bạn!', evidenceChunkIds: [] }
    ]);

    await handler.handle(message);

    expect(channel.getCapturedMessages()).toMatchObject([
      { recipientId: 'customer-123', text: 'Chào bạn!' }
    ]);
    expect(completions).toEqual(['replied']);
    expect(handovers).toEqual([]);
  });

  it('paces a reply before sending it to the customer', async () => {
    const pacedTexts: string[] = [];
    const { handler, channel } = createHarness(
      [{ type: 'reply', text: 'Chào bạn!', evidenceChunkIds: [] }],
      {
        replyPacer: {
          async wait(text) {
            pacedTexts.push(text);
          }
        }
      }
    );

    await handler.handle(message);

    expect(pacedTexts).toEqual(['Chào bạn!']);
    expect(channel.getCapturedMessages()).toHaveLength(1);
  });

  it('transitions to human control when the agent requests handover', async () => {
    const { handler, channel, completions, handovers } = createHarness([
      { type: 'handover', reason: 'needs_staff' }
    ]);

    await handler.handle(message);

    expect(channel.getCapturedMessages()).toEqual([]);
    expect(completions).toEqual(['handed_over']);
    expect(handovers).toEqual(['needs_staff']);
  });

  it('keeps discovery in AI control when the model only asks to search', async () => {
    const { handler, channel, completions, handovers } = createHarness([
      { type: 'handover', reason: 'need to search catalog first' }
    ]);

    await handler.handle(message);

    expect(channel.getCapturedMessages()).toHaveLength(1);
    expect(completions).toEqual(['replied']);
    expect(handovers).toEqual([]);
  });

  it('does not send when conversation control belongs to a human', async () => {
    const { handler, channel, completions, handovers } = createHarness([
      { type: 'reply', text: 'must not send', evidenceChunkIds: [] }
    ]);

    await handler.handle({
      ...message,
      conversation: { ...conversation, controlMode: 'human' }
    });

    expect(channel.getCapturedMessages()).toEqual([]);
    expect(completions).toEqual(['no_action']);
    expect(handovers).toEqual([]);
  });

  it('replies directly to a general capability question without escalating', async () => {
    const { handler, channel, completions, handovers } = createHarness([]);

    await handler.handle({
      ...message,
      text: 'bạn có thể giúp gì cho tôi?'
    });

    const [captured] = channel.getCapturedMessages();
    expect(captured?.recipientId).toBe('customer-123');
    expect(captured?.text).toContain('em có thể hỗ trợ anh/chị');
    expect(completions).toEqual(['replied']);
    expect(handovers).toEqual([]);
  });

  it('does not send an automated reply outside the 24-hour messaging window', async () => {
    const { handler, channel, completions, handovers } = createHarness([
      { type: 'reply', text: 'must not send', evidenceChunkIds: [] }
    ]);

    await handler.handle({
      ...message,
      timestamp: Date.now() - 24 * 60 * 60 * 1_000 - 1
    });

    expect(channel.getCapturedMessages()).toEqual([]);
    expect(completions).toEqual(['handed_over']);
    expect(handovers).toEqual(['messaging_window_expired']);
  });

  it('records an observable error when the outbound channel fails', async () => {
    const errors: string[] = [];
    const failureErrors: string[] = [];
    const handler = new AgentMessageHandler({
      provider: createScriptedDecisionProvider([
        { type: 'reply', text: 'will fail', evidenceChunkIds: [] }
      ]),
      catalog: {} as CatalogService,
      knowledge: {} as KnowledgeService,
      cart: {} as CartService,
      checkout: {} as CheckoutFlow,
      agentRuns: {
        async start() {
          return '44444444-4444-4444-8444-444444444444';
        },
        async recordToolCall() {},
        async complete(input) {
          failureErrors.push(input.error ?? '');
        }
      },
      handovers: { async request() {} },
      channel: {
        async sendText() {
          throw new Error('transport unavailable');
        }
      },
      modelProvider: 'fake',
      modelName: 'fake',
      promptVersion: 'test.v1',
      logger: {
        error(_bindings, event) {
          errors.push(event);
        }
      }
    });

    await handler.handle(message);

    expect(errors).toEqual(['Agent message handling failed']);
    expect(failureErrors).toEqual(['transport unavailable']);
  });
});
