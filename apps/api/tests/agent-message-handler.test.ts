import {
  createScriptedDecisionProvider,
  CheckoutConfirmationError,
  renderPreparedCheckoutConfirmation,
  type PreparedCheckoutConfirmation,
  type CartService,
  type CatalogService,
  type CheckoutOrderConfirmationService,
  type CheckoutFlow,
  type KnowledgeService
} from '@fanpage/domain';
import { InMemoryOutboundMessageRepository } from '@fanpage/db';
import { FakeMessagingChannel, MetaChannelError } from '@fanpage/meta';
import type { OperationalMetrics } from '@fanpage/observability';
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
  options: {
    replyPacer?: ReplyPacer;
    checkoutOrderConfirmation?: CheckoutOrderConfirmationService;
    metrics?: OperationalMetrics;
    outbound?: InMemoryOutboundMessageRepository;
    checkout?: CheckoutFlow;
  } = {}
) {
  const channel = new FakeMessagingChannel();
  const completions: string[] = [];
  const diagnostics: Array<string | undefined> = [];
  const handovers: string[] = [];
  const handler = new AgentMessageHandler({
    provider: createScriptedDecisionProvider(decisions),
    catalog: {} as CatalogService,
    knowledge: {} as KnowledgeService,
    cart: {} as CartService,
    checkout: options.checkout ?? ({} as CheckoutFlow),
    agentRuns: {
      async start() {
        return '44444444-4444-4444-8444-444444444444';
      },
      async recordToolCall() {},
      async complete(input) {
        completions.push(input.outcome);
        diagnostics.push(input.error);
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
    ...(options.outbound ? { outbound: options.outbound } : {}),
    ...(options.replyPacer === undefined
      ? {}
      : { replyPacer: options.replyPacer }),
    ...(options.checkoutOrderConfirmation === undefined
      ? {}
      : { checkoutOrderConfirmation: options.checkoutOrderConfirmation }),
    ...(options.metrics === undefined ? {} : { metrics: options.metrics })
  });
  return { channel, completions, handovers, handler, diagnostics };
}

const message = {
  messageId: '55555555-5555-4555-8555-555555555555',
  customerId: conversation.customerId,
  conversation,
  recipientId: 'customer-123',
  text: 'Xin chào',
  timestamp: Date.now()
};
const prepared: PreparedCheckoutConfirmation = {
  confirmationId: 'persisted-id',
  snapshot: {
    conversationId: conversation.id,
    cartId: conversation.id,
    cartVersion: 1,
    recipientName: 'Test Customer',
    phone: '0900000000',
    address: { line1: 'Test Street', ward: 'Ward', city: 'City' },
    paymentMethod: 'cod',
    currency: 'VND',
    subtotal: 100,
    shippingFee: 0,
    discountTotal: 0,
    total: 100,
    preparedAt: message.timestamp - 1000,
    expiresAt: message.timestamp + 899000,
    nonce: 'test',
    lines: [
      {
        productId: conversation.id,
        variantId: conversation.id,
        sku: 'TEST',
        productName: 'Test Product',
        variantName: 'Default',
        quantity: 1,
        unitPrice: 100,
        lineTotal: 100
      }
    ]
  }
};

describe('AgentMessageHandler', () => {
  it('records provider call metrics from the live handler orchestration', async () => {
    const names: string[] = [];
    const metrics: OperationalMetrics = {
      increment(name) {
        names.push(name);
      },
      observe(name) {
        names.push(name);
      }
    };
    const { handler } = createHarness(
      [{ type: 'reply', intro: 'Dạ em chào anh/chị.', facts: [] }],
      { metrics }
    );
    await handler.handle(message);
    expect(names).toContain('llm_calls_total');
  });
  it('sends the persisted exact summary after the final checkout field even when the model stops', async () => {
    const { handler, channel, handovers } = createHarness(
      [
        {
          type: 'tool',
          name: 'checkout.setPaymentMethod',
          input: { expectedVersion: 1, paymentMethod: 'cod' }
        }
      ],
      {
        checkout: {
          async start() {
            throw new Error('Unexpected checkout start');
          },
          async setRecipientName() {
            throw new Error('Unexpected name');
          },
          async setPhone() {
            throw new Error('Unexpected phone');
          },
          async setAddress() {
            throw new Error('Unexpected address');
          },
          async setPaymentMethod() {
            return {
              conversationId: conversation.id,
              version: 2,
              state: 'awaiting_confirmation',
              recipientName: prepared.snapshot.recipientName,
              phone: prepared.snapshot.phone,
              address: prepared.snapshot.address,
              paymentMethod: 'cod'
            };
          }
        },
        checkoutOrderConfirmation: {
          async linkSummary() {},
          async getPrepared() {
            return prepared;
          },
          async prepareConfirmation() {
            return prepared;
          },
          async confirmPrepared() {
            throw new Error('No consent');
          }
        }
      }
    );
    await handler.handle(message);
    expect(channel.getCapturedMessages()).toMatchObject([
      { text: renderPreparedCheckoutConfirmation(prepared) }
    ]);
    expect(handovers).toEqual([]);
  });
  it.each(['confirmation_stale', 'confirmation_expired'] as const)(
    'shows a newly prepared exact summary after %s and requires new consent',
    async (code) => {
      let preparations = 0;
      const { handler, channel, handovers } = createHarness([], {
        checkoutOrderConfirmation: {
          async linkSummary() {},
          async getPrepared() {
            return prepared;
          },
          async prepareConfirmation() {
            preparations += 1;
            return prepared;
          },
          async confirmPrepared() {
            throw new CheckoutConfirmationError(code);
          }
        }
      });
      await handler.handle({ ...message, text: 'confirm' });
      expect(preparations).toBe(1);
      expect(channel.getCapturedMessages()).toMatchObject([
        { text: renderPreparedCheckoutConfirmation(prepared) }
      ]);
      expect(handovers).toEqual([]);
    }
  );
  it('asks for explicit consent when an existing summary receives ambiguous ok', async () => {
    let confirmations = 0;
    const { handler, channel } = createHarness([], {
      checkoutOrderConfirmation: {
        async linkSummary() {},
        async getPrepared() {
          return prepared;
        },
        async prepareConfirmation() {
          throw new Error('must not regenerate');
        },
        async confirmPrepared() {
          confirmations += 1;
          return { orderId: 'forbidden', orderNumber: 'forbidden' };
        }
      }
    });
    await handler.handle({ ...message, text: 'ok' });
    expect(confirmations).toBe(0);
    expect(channel.getCapturedMessages()[0]?.text).toContain('confirm');
  });
  it('resumes persisted delivery in a fresh handler without running its provider', async () => {
    const outbound = new InMemoryOutboundMessageRepository();
    const first = createHarness(
      [{ type: 'reply', intro: 'Dạ em chào anh/chị.', facts: [] }],
      { outbound }
    );
    first.channel.sendText = async () => {
      throw new MetaChannelError('limited', 'rate_limited', true);
    };
    await expect(first.handler.handle(message)).rejects.toThrow('limited');
    const restarted = createHarness([], { outbound });
    const result = await restarted.handler.handle(message);
    expect(result).toMatchObject({ outcome: 'replied' });
    expect(restarted.channel.getCapturedMessages()).toMatchObject([
      { text: 'Dạ em chào anh/chị.' }
    ]);
    expect(restarted.handovers).toEqual([]);
  });
  it('opens handover for provider failure before planning and returns a terminal outcome', async () => {
    const { handler, handovers, channel } = createHarness([]);
    expect(await handler.handle(message)).toEqual({ outcome: 'handed_over' });
    expect(handovers).toEqual(['script_exhausted']);
    expect(channel.getCapturedMessages()).toEqual([]);
  });
  it('acknowledges an invalid provider decision before handing the conversation to staff', async () => {
    const { handler, handovers, channel, diagnostics } = createHarness([
      {},
      {}
    ]);
    expect(
      await handler.handle({ ...message, text: 'Bánh này có phù hợp không?' })
    ).toMatchObject({ outcome: 'handed_over' });
    expect(handovers).toEqual(['invalid_provider_decision']);
    expect(diagnostics).toContain('provider:schema_invalid');
    expect(channel.getCapturedMessages()).toMatchObject([
      {
        text: 'Dạ em chưa kiểm tra được thông tin lúc này. Anh/chị vui lòng đợi nhân viên hỗ trợ ạ.'
      }
    ]);
  });
  it('acknowledges a rejected ungrounded reply before handing over', async () => {
    const { handler, handovers, channel, diagnostics } = createHarness([
      { type: 'reply', intro: 'Invented answer', facts: [] }
    ]);
    expect(
      await handler.handle({
        ...message,
        text: 'Đơn hàng demo có giao hàng thật không?'
      })
    ).toMatchObject({ outcome: 'handed_over' });
    expect(handovers).toEqual(['grounding_failed']);
    expect(diagnostics).toContain('grounding:unsafe_intro');
    expect(channel.getCapturedMessages()).toMatchObject([
      {
        text: 'Dạ em chưa kiểm tra được thông tin lúc này. Anh/chị vui lòng đợi nhân viên hỗ trợ ạ.'
      }
    ]);
  });
  it('does not send the provider-error acknowledgement outside the messaging window', async () => {
    const { handler, handovers, channel } = createHarness([{}]);
    const result = await handler.handle({
      ...message,
      text: 'Bánh này có phù hợp không?',
      timestamp: Date.now() - 25 * 60 * 60 * 1000
    });
    expect(result).toMatchObject({ outcome: 'handed_over' });
    expect(handovers).toEqual(['messaging_window_expired']);
    expect(channel.getCapturedMessages()).toEqual([]);
  });
  it('retries a definitive rejection using persisted text without rerunning the provider', async () => {
    const { handler, channel, completions } = createHarness([
      { type: 'reply', intro: 'Dạ em chào anh/chị.', facts: [] }
    ]);
    const send = channel.sendText.bind(channel);
    let attempts = 0;
    channel.sendText = async (input) => {
      attempts += 1;
      if (attempts === 1)
        throw new MetaChannelError('limited', 'rate_limited', true);
      return send(input);
    };
    await expect(handler.handle(message)).rejects.toThrow('limited');
    await handler.handle(message);
    expect(channel.getCapturedMessages()).toMatchObject([
      { text: 'Dạ em chào anh/chị.' }
    ]);
    expect(completions.at(-1)).toBe('replied');
    await handler.handle(message);
    expect(attempts).toBe(2);
  });

  it('does not resend an ambiguous transport outcome and durably hands over', async () => {
    const { handler, channel, handovers } = createHarness([
      { type: 'reply', intro: 'Dạ em chào anh/chị.', facts: [] }
    ]);
    let attempts = 0;
    channel.sendText = async () => {
      attempts += 1;
      throw new MetaChannelError('network', 'network', true);
    };
    await handler.handle(message);
    await handler.handle(message);
    expect(attempts).toBe(1);
    expect(handovers).toContain('meta_delivery_network');
  });
  it('sends an agent reply through the channel and records the outcome', async () => {
    const { handler, channel, completions, handovers } = createHarness([
      { type: 'reply', intro: 'Dạ em chào anh/chị.', facts: [] }
    ]);

    await handler.handle(message);

    expect(channel.getCapturedMessages()).toMatchObject([
      { recipientId: 'customer-123', text: 'Dạ em chào anh/chị.' }
    ]);
    expect(completions).toEqual(['replied']);
    expect(handovers).toEqual([]);
  });

  it('paces a reply before sending it to the customer', async () => {
    const pacedTexts: string[] = [];
    const { handler, channel } = createHarness(
      [{ type: 'reply', intro: 'Dạ em chào anh/chị.', facts: [] }],
      {
        replyPacer: {
          async wait(text) {
            pacedTexts.push(text);
          }
        }
      }
    );

    await handler.handle(message);

    expect(pacedTexts).toEqual(['Dạ em chào anh/chị.']);
    expect(channel.getCapturedMessages()).toHaveLength(1);
  });

  it('emits a redacted agent latency metric after a customer reply', async () => {
    const metrics: Array<{ name: string; labels: Record<string, string> }> = [];
    const { handler } = createHarness(
      [{ type: 'reply', intro: 'Dạ em chào anh/chị.', facts: [] }],
      {
        metrics: {
          increment() {},
          observe(name, _value, labels = {}) {
            metrics.push({ name, labels });
          }
        }
      }
    );

    await handler.handle(message);

    expect(metrics).toContainEqual({
      name: 'agent_latency_ms',
      labels: { outcome: 'replied' }
    });
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
      { type: 'reply', intro: 'Dạ em chào anh/chị.', facts: [] }
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
      { type: 'reply', intro: 'Dạ em chào anh/chị.', facts: [] }
    ]);

    await handler.handle({
      ...message,
      timestamp: Date.now() - 24 * 60 * 60 * 1_000 - 1
    });

    expect(channel.getCapturedMessages()).toEqual([]);
    expect(completions).toEqual(['handed_over']);
    expect(handovers).toEqual(['messaging_window_expired']);
  });

  it('creates an order only after explicit customer confirmation', async () => {
    const confirmed: string[] = [];
    const { handler, channel } = createHarness([], {
      checkoutOrderConfirmation: {
        async linkSummary() {},
        async getPrepared() {
          return {
            confirmationId: 'prepared-before-consent',
            snapshot: {} as never
          };
        },
        async prepareConfirmation() {
          throw new Error('Must not prepare after consent');
        },
        async confirmPrepared(input) {
          expect(input.confirmationId).toBe('prepared-before-consent');
          expect(input.confirmationMessageTimestamp).toBe(message.timestamp);
          confirmed.push(input.conversationId);
          return { orderId: 'order-1', orderNumber: 'ORD-TEST' };
        }
      }
    });

    await handler.handle({ ...message, text: 'xác nhận' });

    expect(confirmed).toEqual([conversation.id]);
    expect(channel.getCapturedMessages()[0]?.text).toContain('ORD-TEST');
  });

  it('records an observable error when the outbound channel fails', async () => {
    const errors: string[] = [];
    const failureErrors: string[] = [];
    const handler = new AgentMessageHandler({
      provider: createScriptedDecisionProvider([
        { type: 'reply', intro: 'Dạ em chào anh/chị.', facts: [] }
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
    expect(failureErrors).toEqual(['agent_failed', '']);
  });

  it('rethrows a retryable Meta send failure for the durable queue', async () => {
    const handler = new AgentMessageHandler({
      provider: createScriptedDecisionProvider([
        { type: 'reply', intro: 'Dạ em chào anh/chị.', facts: [] }
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
        async complete() {}
      },
      handovers: { async request() {} },
      channel: {
        async sendText() {
          throw new MetaChannelError('limited', 'rate_limited', true, 429);
        }
      },
      modelProvider: 'fake',
      modelName: 'fake',
      promptVersion: 'test.v1'
    });

    await expect(handler.handle(message)).rejects.toMatchObject({
      code: 'rate_limited',
      retryable: true
    });
  });

  it('hands a conversation to staff after a non-retryable Meta delivery failure', async () => {
    const handovers: string[] = [];
    const metrics: Array<{ name: string; labels: Record<string, string> }> = [];
    const handler = new AgentMessageHandler({
      provider: createScriptedDecisionProvider([
        { type: 'reply', intro: 'Dạ em chào anh/chị.', facts: [] }
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
        async complete() {}
      },
      handovers: {
        async request(input) {
          handovers.push(input.reason);
        }
      },
      channel: {
        async sendText() {
          throw new MetaChannelError(
            'recipient is unavailable',
            'invalid_request',
            false,
            400
          );
        }
      },
      modelProvider: 'fake',
      modelName: 'fake',
      promptVersion: 'test.v1',
      metrics: {
        increment(name, labels = {}) {
          metrics.push({ name, labels });
        },
        observe() {}
      }
    });

    await handler.handle(message);

    expect(handovers).toEqual(['meta_delivery_invalid_request']);
    expect(metrics).toContainEqual({
      name: 'meta_send_errors_total',
      labels: { code: 'invalid_request', retryable: 'false' }
    });
  });
});
