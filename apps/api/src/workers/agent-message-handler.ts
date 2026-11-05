import {
  InMemoryOutboundMessageRepository,
  type OutboundMessageRepository,
  type CommerceRepository,
  type ConversationLeaseContext
} from '@fanpage/db';
import { createHash } from 'node:crypto';
import {
  createAgentOrchestrator,
  CheckoutConfirmationError,
  createScopedCartAgentTools,
  renderPreparedCheckoutConfirmation,
  createCheckoutAgentTools,
  createReadOnlyAgentTools,
  type CartService,
  type CatalogService,
  type CheckoutFlow,
  type ConversationContextRepository,
  type AgentContext,
  type PreparedCheckoutConfirmation,
  type KnowledgeService,
  type StructuredDecisionProvider
} from '@fanpage/domain';
import { MetaChannelError, type MessagingChannel } from '@fanpage/meta';
import type { OperationalMetrics } from '@fanpage/observability';
import type {
  AgentHandlingResult,
  PersistedInboundMessageHandler
} from './inbound-message-worker.js';
import type { ReplyPacer } from './reply-pacer.js';
import type { CheckoutOrderConfirmationService } from '@fanpage/domain';

interface AgentRunStore {
  startOrResume?(
    input: Parameters<AgentRunStore['start']>[0]
  ): Promise<{ id: string; resumed: boolean; finalOutcome: string | null }>;
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
    step?: number;
    resultRefIds?: string[];
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
    lease?: ConversationLeaseContext | undefined;
    outboundMessageId?: string | undefined;
  }): Promise<unknown>;
}

interface ErrorLogger {
  error(bindings: Record<string, unknown>, message: string): void;
}

const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1_000;
class ReplySuppressed extends Error {}
class DeliveryHandedOver extends Error {}
const EXPLICIT_ORDER_CONFIRMATION =
  /^(xác nhận|đồng ý|chốt đơn|confirm|yes)$/iu;
const GENERAL_CAPABILITY_QUESTIONS = new Set([
  'bạn có thể giúp gì cho tôi?',
  'bạn có thể giúp gì?',
  'bạn giúp được gì?',
  'bạn làm được gì?'
]);
const GENERAL_CAPABILITY_REPLY =
  'Dạ em có thể hỗ trợ anh/chị tìm sản phẩm, kiểm tra thông tin và đặt hàng. Anh/chị đang quan tâm sản phẩm nào để em tư vấn kỹ hơn ạ?';
const RECOVERABLE_MODEL_HANDOVER =
  /need to search|no store facts|greeting|general capability/i;
const PRODUCT_DISCOVERY_REPLY =
  'Dạ em hỗ trợ anh/chị chọn sản phẩm phù hợp nhé. Anh/chị đang tìm sản phẩm cho dịp nào ạ?';

function canSendAutomatedReply(timestamp: number, now = Date.now()): boolean {
  return timestamp <= now && now - timestamp <= MESSAGING_WINDOW_MS;
}

function isGeneralCapabilityQuestion(text: string): boolean {
  return GENERAL_CAPABILITY_QUESTIONS.has(text.trim().toLocaleLowerCase('vi'));
}

function isExplicitOrderConfirmation(text: string): boolean {
  return EXPLICIT_ORDER_CONFIRMATION.test(text.trim());
}

export class AgentMessageHandler implements PersistedInboundMessageHandler {
  private readonly outbound: OutboundMessageRepository;
  constructor(
    private readonly input: {
      provider: StructuredDecisionProvider;
      catalog: CatalogService;
      knowledge: KnowledgeService;
      cart: CartService;
      checkout: CheckoutFlow;
      checkoutOrderConfirmation?: CheckoutOrderConfirmationService;
      agentRuns: AgentRunStore;
      handovers: HandoverStore;
      channel: MessagingChannel;
      modelProvider: string;
      modelName: string;
      promptVersion: string;
      replyPacer?: ReplyPacer;
      logger?: ErrorLogger;
      metrics?: OperationalMetrics;
      outbound?: OutboundMessageRepository;
      repository?: CommerceRepository;
      contextRepository?: ConversationContextRepository & {
        saveProductReferences?(input: {
          conversationId: string;
          turnId: string;
          items: Array<{
            position: number;
            productId: string;
            variantId: string | null;
          }>;
        }): Promise<void>;
      };
      summaryRepository?: {
        refreshIfNeeded(input: {
          conversationId: string;
          context: AgentContext;
        }): Promise<boolean>;
      };
    }
  ) {
    this.outbound = input.outbound ?? new InMemoryOutboundMessageRepository();
  }

  private async sendPacedText(input: {
    recipientId: string;
    text: string;
    timestamp: number;
    messageId: string;
    conversation: { id: string; version: number };
    summaryConfirmationId?: string | undefined;
    lease?: ConversationLeaseContext | undefined;
  }): Promise<boolean> {
    const planned = await this.outbound.planText({
      conversationId: input.conversation.id,
      inboundMessageId: input.messageId,
      recipientId: input.recipientId,
      text: input.text,
      outboundKey: createHash('sha256')
        .update(`meta:text:${input.messageId}:primary`)
        .digest('hex')
    });
    if (input.summaryConfirmationId && this.input.checkoutOrderConfirmation) {
      await this.input.checkoutOrderConfirmation.linkSummary({
        conversationId: input.conversation.id,
        confirmationId: input.summaryConfirmationId,
        messageId: planned.id,
        text: input.text
      });
    }
    if (
      planned.deliveryState === 'sent' ||
      planned.deliveryState === 'delivered'
    )
      return true;
    await this.input.replyPacer?.wait(input.text);
    if (!canSendAutomatedReply(input.timestamp)) {
      await this.outbound.markFailed(
        planned.id,
        'messaging_window_expired',
        'Messaging window expired'
      );
      await this.input.handovers.request({
        conversationId: input.conversation.id,
        expectedVersion: input.conversation.version,
        lease: input.lease,
        reason: 'messaging_window_expired',
        outboundMessageId: planned.id
      });
      throw new DeliveryHandedOver();
    }
    const claim = await this.outbound.claimForSend(planned.id);
    if (claim === 'already_sent') return true;
    if (claim === 'suppressed') throw new ReplySuppressed();
    if (claim === 'uncertain') {
      await this.input.handovers.request({
        conversationId: input.conversation.id,
        expectedVersion: input.conversation.version,
        lease: input.lease,
        outboundMessageId: planned.id,
        reason: `meta_delivery_${planned.lastErrorCode ?? 'unknown'}`
      });
      throw new DeliveryHandedOver();
    }
    try {
      const sent = await this.input.channel.sendText({
        recipientId: planned.recipientId,
        text: planned.text
      });
      await this.outbound.markSent(planned.id, sent.messageId);
      this.input.metrics?.increment('meta_sends_total', { status: 'sent' });
    } catch (error) {
      const code = error instanceof MetaChannelError ? error.code : 'network';
      if (code === 'rate_limited')
        await this.outbound.markRetryable(
          planned.id,
          code,
          'Meta rejected rate limit'
        );
      else if (code === 'authentication' || code === 'invalid_request')
        await this.outbound.markFailed(
          planned.id,
          code,
          'Meta rejected message'
        );
      else
        await this.outbound.markUnknown(
          planned.id,
          code,
          'Delivery outcome unknown'
        );
      throw error;
    }
    return true;
  }

  private async completeAgentRun(
    input: Parameters<AgentRunStore['complete']>[0],
    emitBusinessMetrics = true
  ): Promise<void> {
    await this.input.agentRuns.complete(input);
    this.input.metrics?.observe('agent_latency_ms', input.latencyMs, {
      outcome: input.outcome
    });
    if (input.outcome === 'handed_over' && emitBusinessMetrics) {
      this.input.metrics?.increment('handovers_total', {
        outcome: input.outcome
      });
    }
  }

  async handle(
    message: Parameters<PersistedInboundMessageHandler['handle']>[0]
  ): Promise<AgentHandlingResult> {
    let outcome: AgentHandlingResult['outcome'] = 'no_action';
    const complete = async (
      value: Parameters<AgentRunStore['complete']>[0]
    ) => {
      await this.completeAgentRun(value, !run.resumed);
      if (value.outcome !== 'failed') outcome = value.outcome;
    };
    const finish = async (): Promise<AgentHandlingResult> => {
      const outbound = await this.outbound.findByInboundMessage(
        message.messageId
      );
      return {
        outcome,
        ...(outbound ? { outboundMessageId: outbound.id } : {})
      };
    };
    const startedAt = performance.now();
    const runInput = {
      conversationId: message.conversation.id,
      inboundMessageId: message.messageId,
      modelProvider: this.input.modelProvider,
      modelName: this.input.modelName,
      promptVersion: this.input.promptVersion
    };
    const run = this.input.agentRuns.startOrResume
      ? await this.input.agentRuns.startOrResume(runInput)
      : {
          id: await this.input.agentRuns.start(runInput),
          resumed: false,
          finalOutcome: null
        };
    const agentRunId = run.id;
    try {
      const pending = await this.outbound.findByInboundMessage(
        message.messageId
      );
      if (pending) {
        const currentSummary =
          await this.input.checkoutOrderConfirmation?.getPrepared(
            message.conversation.id
          );
        const sent = await this.sendPacedText({
          ...message,
          text: pending.text,
          ...(currentSummary &&
          pending.text === renderPreparedCheckoutConfirmation(currentSummary)
            ? { summaryConfirmationId: currentSummary.confirmationId }
            : {})
        });
        await complete({
          agentRunId,
          outcome: sent ? 'replied' : 'handed_over',
          latencyMs: Math.round(performance.now() - startedAt)
        });
        return await finish();
      }
      if (run.resumed) {
        if (run.finalOutcome === 'handed_over') outcome = 'handed_over';
        if (
          run.finalOutcome === 'no_action' ||
          run.finalOutcome === 'handed_over'
        )
          return await finish();
        await this.input.handovers.request({
          conversationId: message.conversation.id,
          expectedVersion: message.conversation.version,
          lease: message.lease,
          reason: 'interrupted_agent_turn'
        });
        await complete({
          agentRunId,
          outcome: 'handed_over',
          latencyMs: Math.round(performance.now() - startedAt)
        });
        return await finish();
      }
      const loadedContext = await this.input.contextRepository?.load({
        conversationId: message.conversation.id,
        recentMessageLimit: 12,
        recentCharacterBudget: 4000,
        excludeMessageId: message.messageId
      });
      const context = {
        controlMode: message.conversation.controlMode,
        productReferences: [],
        recentMessages: [],
        cart: null,
        checkout: null,
        ...loadedContext,
        customerMessage: message.text
      };
      if (this.input.summaryRepository) {
        try {
          await this.input.summaryRepository.refreshIfNeeded({
            conversationId: message.conversation.id,
            context
          });
        } catch {
          this.input.logger?.error(
            {
              code: 'summary_refresh_failed',
              conversationId: message.conversation.id
            },
            'Conversation summary refresh failed'
          );
        }
      }
      if (context.controlMode !== 'ai') {
        await complete({
          agentRunId,
          outcome: 'no_action',
          latencyMs: Math.round(performance.now() - startedAt)
        });
        return await finish();
      }
      if (!canSendAutomatedReply(message.timestamp)) {
        await this.input.handovers.request({
          conversationId: message.conversation.id,
          expectedVersion: message.conversation.version,
          lease: message.lease,
          reason: 'messaging_window_expired'
        });
        await complete({
          agentRunId,
          outcome: 'handed_over',
          latencyMs: Math.round(performance.now() - startedAt)
        });
        return await finish();
      }
      if (
        /^(ok|okay|được)$/iu.test(message.text.trim()) &&
        this.input.checkoutOrderConfirmation &&
        (await this.input.checkoutOrderConfirmation.getPrepared(
          message.conversation.id
        ))
      ) {
        const sent = await this.sendPacedText({
          ...message,
          text: 'Please reply "confirm" after reviewing the order summary, or describe the changes you need.'
        });
        await complete({
          agentRunId,
          outcome: sent ? 'replied' : 'no_action',
          latencyMs: Math.round(performance.now() - startedAt)
        });
        return await finish();
      }
      if (
        isExplicitOrderConfirmation(message.text) &&
        this.input.checkoutOrderConfirmation
      ) {
        const prepared = await this.input.checkoutOrderConfirmation.getPrepared(
          message.conversation.id
        );
        if (!prepared) {
          const sent = await this.sendPacedText({
            ...message,
            text: 'Please complete checkout and review the order summary before confirming.'
          });
          await complete({
            agentRunId,
            outcome: sent ? 'replied' : 'no_action',
            latencyMs: Math.round(performance.now() - startedAt)
          });
          return await finish();
        }
        let order: { orderId: string; orderNumber: string; replayed?: boolean };
        try {
          order = await this.input.checkoutOrderConfirmation.confirmPrepared({
            conversationId: message.conversation.id,
            confirmationId: prepared.confirmationId,
            confirmationMessageTimestamp: message.timestamp
          });
        } catch (error) {
          if (
            !(error instanceof CheckoutConfirmationError) ||
            !['confirmation_stale', 'confirmation_expired'].includes(error.code)
          )
            throw error;
          this.input.metrics?.increment('checkout_completions_total', {
            status: error.code
          });
          const refreshed =
            await this.input.checkoutOrderConfirmation.prepareConfirmation(
              message.conversation.id
            );
          this.input.metrics?.increment('checkout_completions_total', {
            status: 'prepared'
          });
          const sent = await this.sendPacedText({
            ...message,
            text: renderPreparedCheckoutConfirmation(refreshed),
            summaryConfirmationId: refreshed.confirmationId
          });
          await complete({
            agentRunId,
            outcome: sent ? 'replied' : 'no_action',
            latencyMs: Math.round(performance.now() - startedAt)
          });
          return await finish();
        }
        if (order.replayed !== undefined)
          this.input.metrics?.increment('orders_total', {
            status: order.replayed ? 'replayed' : 'created'
          });
        this.input.metrics?.increment('checkout_completions_total', {
          status: 'consumed'
        });
        const sent = await this.sendPacedText({
          ...message,
          recipientId: message.recipientId,
          text: `Đơn hàng ${order.orderNumber} đã được xác nhận.`,
          timestamp: message.timestamp
        });
        await complete({
          agentRunId,
          outcome: sent ? 'replied' : 'handed_over',
          latencyMs: Math.round(performance.now() - startedAt)
        });
        return await finish();
      }
      if (
        isGeneralCapabilityQuestion(message.text) &&
        canSendAutomatedReply(message.timestamp)
      ) {
        const sent = await this.sendPacedText({
          ...message,
          recipientId: message.recipientId,
          text: GENERAL_CAPABILITY_REPLY,
          timestamp: message.timestamp
        });
        if (!sent) {
          await this.input.handovers.request({
            conversationId: message.conversation.id,
            expectedVersion: message.conversation.version,
            lease: message.lease,
            reason: 'messaging_window_expired'
          });
          await complete({
            agentRunId,
            outcome: 'handed_over',
            latencyMs: Math.round(performance.now() - startedAt)
          });
          return await finish();
        }
        await complete({
          agentRunId,
          outcome: 'replied',
          latencyMs: Math.round(performance.now() - startedAt)
        });
        return await finish();
      }
      let preparedDuringTurn: PreparedCheckoutConfirmation | undefined;
      const agent = createAgentOrchestrator({
        provider: this.input.provider,
        metrics: this.input.metrics,
        tools: [
          ...createReadOnlyAgentTools({
            catalog: this.input.catalog,
            knowledge: this.input.knowledge
          }),
          ...createScopedCartAgentTools({
            cart: this.input.cart,
            customerId: message.customerId,
            conversationId: message.conversation.id
          }),
          ...createCheckoutAgentTools({
            checkout: this.input.checkout,
            conversationId: message.conversation.id,
            ...(this.input.checkoutOrderConfirmation
              ? { confirmation: this.input.checkoutOrderConfirmation }
              : {})
          }).map((tool) => ({
            ...tool,
            execute: async (value: unknown) => {
              const result = await tool.execute(value);
              if (
                this.input.checkoutOrderConfirmation &&
                (tool.name === 'checkout.setPaymentMethod' ||
                  tool.name === 'checkout.prepareConfirmation')
              ) {
                preparedDuringTurn =
                  (await this.input.checkoutOrderConfirmation.getPrepared(
                    message.conversation.id
                  )) ??
                  (await this.input.checkoutOrderConfirmation.prepareConfirmation(
                    message.conversation.id
                  ));
                this.input.metrics?.increment('checkout_completions_total', {
                  status: 'prepared'
                });
              }
              return result;
            }
          }))
        ]
      });
      const result = await agent.run(context);
      for (const toolCall of result.trace.toolCalls) {
        if (
          toolCall.status === 'succeeded' &&
          toolCall.name === 'checkout.start'
        )
          this.input.metrics?.increment('checkout_starts_total');
        await this.input.agentRuns.recordToolCall({
          agentRunId,
          toolName: toolCall.name,
          arguments: toolCall.argumentSummary,
          resultSummary: toolCall.resultSummary,
          step: toolCall.step,
          resultRefIds: toolCall.resultRefIds,
          status: toolCall.status,
          latencyMs: toolCall.latencyMs
        });
      }
      const latencyMs = Math.round(performance.now() - startedAt);
      if (preparedDuringTurn && result.type !== 'suppressed') {
        const sent = await this.sendPacedText({
          ...message,
          text: renderPreparedCheckoutConfirmation(preparedDuringTurn),
          summaryConfirmationId: preparedDuringTurn.confirmationId
        });
        await complete({
          agentRunId,
          outcome: sent ? 'replied' : 'handed_over',
          latencyMs
        });
        return await finish();
      }
      if (result.type === 'suppressed') {
        await complete({
          agentRunId,
          outcome: 'no_action',
          latencyMs
        });
        return await finish();
      }
      if (result.type === 'handover') {
        if (RECOVERABLE_MODEL_HANDOVER.test(result.reason)) {
          const sent = await this.sendPacedText({
            ...message,
            recipientId: message.recipientId,
            text: PRODUCT_DISCOVERY_REPLY,
            timestamp: message.timestamp
          });
          await complete({
            agentRunId,
            outcome: sent ? 'replied' : 'handed_over',
            latencyMs: Math.round(performance.now() - startedAt)
          });
          if (sent) return await finish();
        }
        await this.input.handovers.request({
          conversationId: message.conversation.id,
          expectedVersion: message.conversation.version,
          lease: message.lease,
          reason: result.reason
        });
        await complete({
          agentRunId,
          outcome: 'handed_over',
          latencyMs
        });
        return await finish();
      }
      if (!canSendAutomatedReply(message.timestamp)) {
        await this.input.handovers.request({
          conversationId: message.conversation.id,
          expectedVersion: message.conversation.version,
          lease: message.lease,
          reason: 'messaging_window_expired'
        });
        await complete({
          agentRunId,
          outcome: 'handed_over',
          latencyMs
        });
        return await finish();
      }
      if (this.input.contextRepository?.saveProductReferences) {
        const references: Array<{
          position: number;
          productId: string;
          variantId: string | null;
        }> = [];
        for (const fact of result.factRefs) {
          if (fact.type === 'catalog_product')
            references.push({
              position: references.length + 1,
              productId: fact.productId,
              variantId: null
            });
          if (fact.type === 'catalog_variant') {
            const evidence = result.trace.toolCalls
              .flatMap((call) => call.evidence ?? [])
              .find(
                (item) =>
                  item.type === 'catalog_variant' &&
                  item.value.variantId === fact.variantId
              );
            if (evidence?.type === 'catalog_variant')
              references.push({
                position: references.length + 1,
                productId: evidence.value.productId,
                variantId: evidence.value.variantId
              });
          }
        }
        if (references.length)
          await this.input.contextRepository.saveProductReferences({
            conversationId: message.conversation.id,
            turnId: agentRunId,
            items: references
          });
      }
      let replyText = result.text;
      let summaryConfirmationId: string | undefined;
      if (
        this.input.checkoutOrderConfirmation &&
        result.trace.toolCalls.some(
          (call) =>
            call.status === 'succeeded' &&
            (call.name === 'checkout.setPaymentMethod' ||
              call.name === 'checkout.prepareConfirmation')
        )
      ) {
        const prepared =
          (await this.input.checkoutOrderConfirmation.getPrepared(
            message.conversation.id
          )) ??
          (await this.input.checkoutOrderConfirmation.prepareConfirmation(
            message.conversation.id
          ));
        replyText = renderPreparedCheckoutConfirmation(prepared);
        summaryConfirmationId = prepared.confirmationId;
      }
      const sent = await this.sendPacedText({
        ...message,
        recipientId: message.recipientId,
        text: replyText,
        ...(summaryConfirmationId ? { summaryConfirmationId } : {}),
        timestamp: message.timestamp
      });
      if (!sent) {
        await this.input.handovers.request({
          conversationId: message.conversation.id,
          expectedVersion: message.conversation.version,
          lease: message.lease,
          reason: 'messaging_window_expired'
        });
        await complete({
          agentRunId,
          outcome: 'handed_over',
          latencyMs: Math.round(performance.now() - startedAt)
        });
        return await finish();
      }
      await complete({
        agentRunId,
        outcome: 'replied',
        latencyMs: Math.round(performance.now() - startedAt)
      });
    } catch (error) {
      if (
        error instanceof ReplySuppressed ||
        error instanceof DeliveryHandedOver
      ) {
        await complete({
          agentRunId,
          outcome:
            error instanceof ReplySuppressed ? 'no_action' : 'handed_over',
          latencyMs: Math.round(performance.now() - startedAt)
        });
        return await finish();
      }
      const errorMessage =
        error instanceof MetaChannelError ? error.code : 'agent_failed';
      this.input.logger?.error(
        {
          code: error instanceof MetaChannelError ? error.code : 'agent_failed',
          agentRunId,
          conversationId: message.conversation.id,
          inboundMessageId: message.messageId
        },
        'Agent message handling failed'
      );
      await complete({
        agentRunId,
        outcome: 'failed',
        latencyMs: Math.round(performance.now() - startedAt),
        error: errorMessage.slice(0, 500)
      });
      if (error instanceof MetaChannelError && error.code === 'rate_limited')
        throw error;
      {
        this.input.metrics?.increment('meta_send_errors_total', {
          code: error instanceof MetaChannelError ? error.code : 'agent_failed',
          retryable: 'false'
        });
        await this.input.handovers.request({
          conversationId: message.conversation.id,
          expectedVersion: message.conversation.version,
          lease: message.lease,
          reason:
            error instanceof MetaChannelError
              ? `meta_delivery_${error.code}`
              : 'agent_failed',
          outboundMessageId: (
            await this.outbound.findByInboundMessage(message.messageId)
          )?.id
        });
        await complete({
          agentRunId,
          outcome: 'handed_over',
          latencyMs: Math.round(performance.now() - startedAt)
        });
      }
    }
    return finish();
  }
}
