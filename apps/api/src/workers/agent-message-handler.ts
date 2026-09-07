import {
  createAgentOrchestrator,
  createCartAgentTools,
  createCheckoutAgentTools,
  createReadOnlyAgentTools,
  type AgentTool,
  type CartService,
  type CatalogService,
  type CheckoutFlow,
  type KnowledgeService,
  type StructuredDecisionProvider
} from '@fanpage/domain';
import type { MessagingChannel } from '@fanpage/meta';
import type { PersistedInboundMessageHandler } from './inbound-message-worker.js';
import type { ReplyPacer } from './reply-pacer.js';

interface AgentRunStore {
  start(input: {
    conversationId: string;
    inboundMessageId: string;
    modelProvider: string;
    modelName: string;
    promptVersion: string;
  }): Promise<string>;
  recordToolCall(input: {
    agentRunId: string;
    toolName: string;
    arguments: Record<string, string | number | boolean | null>;
    resultSummary: Record<string, string | number | boolean | null>;
    status: 'succeeded' | 'failed';
    latencyMs: number;
  }): Promise<void>;
  complete(input: {
    agentRunId: string;
    outcome: 'replied' | 'handed_over' | 'no_action' | 'failed';
    latencyMs: number;
    error?: string;
  }): Promise<void>;
}

interface HandoverStore {
  request(input: {
    conversationId: string;
    expectedVersion: number;
    reason: string;
  }): Promise<unknown>;
}

interface ErrorLogger {
  error(bindings: Record<string, unknown>, message: string): void;
}

const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1_000;
const GENERAL_CAPABILITY_QUESTIONS = new Set([
  'bạn có thể giúp gì cho tôi?',
  'bạn có thể giúp gì?',
  'bạn giúp được gì?',
  'bạn làm được gì?'
]);
const GENERAL_CAPABILITY_REPLY =
  'Chào bạn! Tôi có thể giúp bạn tìm sản phẩm, kiểm tra thông tin sản phẩm và hỗ trợ đặt hàng. Bạn đang quan tâm sản phẩm nào ạ?';

function canSendAutomatedReply(timestamp: number, now = Date.now()): boolean {
  return timestamp <= now && now - timestamp <= MESSAGING_WINDOW_MS;
}

function isGeneralCapabilityQuestion(text: string): boolean {
  return GENERAL_CAPABILITY_QUESTIONS.has(text.trim().toLocaleLowerCase('vi'));
}

function scopedCartTools(input: {
  cart: CartService;
  customerId: string;
  conversationId: string;
}): AgentTool[] {
  return createCartAgentTools({ cart: input.cart }).map((tool) => {
    if (tool.name !== 'cart.add') return tool;
    return {
      ...tool,
      execute: async (value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error('Cart add input must be an object');
        }
        return tool.execute({
          ...value,
          customerId: input.customerId,
          conversationId: input.conversationId
        });
      }
    };
  });
}

export class AgentMessageHandler implements PersistedInboundMessageHandler {
  constructor(
    private readonly input: {
      provider: StructuredDecisionProvider;
      catalog: CatalogService;
      knowledge: KnowledgeService;
      cart: CartService;
      checkout: CheckoutFlow;
      agentRuns: AgentRunStore;
      handovers: HandoverStore;
      channel: MessagingChannel;
      modelProvider: string;
      modelName: string;
      promptVersion: string;
      replyPacer?: ReplyPacer;
      logger?: ErrorLogger;
    }
  ) {}

  async handle(
    message: Parameters<PersistedInboundMessageHandler['handle']>[0]
  ): Promise<void> {
    const startedAt = performance.now();
    const agentRunId = await this.input.agentRuns.start({
      conversationId: message.conversation.id,
      inboundMessageId: message.messageId,
      modelProvider: this.input.modelProvider,
      modelName: this.input.modelName,
      promptVersion: this.input.promptVersion
    });
    try {
      if (
        isGeneralCapabilityQuestion(message.text) &&
        canSendAutomatedReply(message.timestamp)
      ) {
        await this.input.replyPacer?.wait(GENERAL_CAPABILITY_REPLY);
        await this.input.channel.sendText({
          recipientId: message.recipientId,
          text: GENERAL_CAPABILITY_REPLY
        });
        await this.input.agentRuns.complete({
          agentRunId,
          outcome: 'replied',
          latencyMs: Math.round(performance.now() - startedAt)
        });
        return;
      }
      const agent = createAgentOrchestrator({
        provider: this.input.provider,
        tools: [
          ...createReadOnlyAgentTools({
            catalog: this.input.catalog,
            knowledge: this.input.knowledge
          }),
          ...scopedCartTools({
            cart: this.input.cart,
            customerId: message.customerId,
            conversationId: message.conversation.id
          }),
          ...createCheckoutAgentTools({
            checkout: this.input.checkout,
            conversationId: message.conversation.id
          })
        ]
      });
      const result = await agent.run({
        customerMessage: message.text,
        controlMode: message.conversation.controlMode,
        productReferences: []
      });
      await Promise.all(
        result.trace.toolCalls.map((toolCall) =>
          this.input.agentRuns.recordToolCall({
            agentRunId,
            toolName: toolCall.name,
            arguments: {},
            resultSummary: {},
            status: toolCall.status,
            latencyMs: toolCall.latencyMs
          })
        )
      );
      const latencyMs = Math.round(performance.now() - startedAt);
      if (result.type === 'suppressed') {
        await this.input.agentRuns.complete({
          agentRunId,
          outcome: 'no_action',
          latencyMs
        });
        return;
      }
      if (result.type === 'handover') {
        await this.input.handovers.request({
          conversationId: message.conversation.id,
          expectedVersion: message.conversation.version,
          reason: result.reason
        });
        await this.input.agentRuns.complete({
          agentRunId,
          outcome: 'handed_over',
          latencyMs
        });
        return;
      }
      if (!canSendAutomatedReply(message.timestamp)) {
        await this.input.handovers.request({
          conversationId: message.conversation.id,
          expectedVersion: message.conversation.version,
          reason: 'messaging_window_expired'
        });
        await this.input.agentRuns.complete({
          agentRunId,
          outcome: 'handed_over',
          latencyMs
        });
        return;
      }
      await this.input.replyPacer?.wait(result.text);
      await this.input.channel.sendText({
        recipientId: message.recipientId,
        text: result.text
      });
      await this.input.agentRuns.complete({
        agentRunId,
        outcome: 'replied',
        latencyMs
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.input.logger?.error(
        {
          error,
          agentRunId,
          conversationId: message.conversation.id,
          inboundMessageId: message.messageId
        },
        'Agent message handling failed'
      );
      await this.input.agentRuns.complete({
        agentRunId,
        outcome: 'failed',
        latencyMs: Math.round(performance.now() - startedAt),
        error: errorMessage.slice(0, 500)
      });
    }
  }
}
