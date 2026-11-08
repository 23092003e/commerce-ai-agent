import { randomUUID } from 'node:crypto';
import type {
  OutboundMessageRepository,
  OutboundMessageView,
  OutboundDeliveryState
} from './types.js';

/** Local/test adapter; production uses the PostgreSQL store. */
export class InMemoryOutboundMessageRepository implements OutboundMessageRepository {
  private readonly rows = new Map<string, OutboundMessageView>();
  async planText(
    input: Parameters<OutboundMessageRepository['planText']>[0]
  ): Promise<OutboundMessageView> {
    const existing = [...this.rows.values()].find(
      (row) => row.outboundKey === input.outboundKey
    );
    if (existing) return structuredClone(existing);
    const row: OutboundMessageView = {
      ...input,
      id: randomUUID(),
      deliveryState: 'queued',
      attempts: 0,
      lastErrorCode: null
    };
    this.rows.set(row.id, row);
    return structuredClone(row);
  }
  async findByInboundMessage(id: string): Promise<OutboundMessageView | null> {
    return structuredClone(
      [...this.rows.values()].find((row) => row.inboundMessageId === id) ?? null
    );
  }
  async claimForSend(
    id: string
  ): Promise<'claimed' | 'already_sent' | 'uncertain'> {
    const row = this.rows.get(id);
    if (!row) throw new Error('Outbound not found');
    if (['sent', 'delivered'].includes(row.deliveryState))
      return 'already_sent';
    if (['queued', 'retryable'].includes(row.deliveryState)) {
      row.deliveryState = 'sending';
      row.attempts += 1;
      return 'claimed';
    }
    if (row.deliveryState === 'sending') row.deliveryState = 'unknown';
    return 'uncertain';
  }
  private mark(
    id: string,
    state: OutboundDeliveryState,
    code: string | null
  ): void {
    const row = this.rows.get(id);
    if (row?.deliveryState === 'sending') {
      row.deliveryState = state;
      row.lastErrorCode = code;
    }
  }
  async markSent(id: string): Promise<void> {
    this.mark(id, 'sent', null);
  }
  async markRetryable(id: string, code: string): Promise<void> {
    this.mark(id, 'retryable', code);
  }
  async markUnknown(id: string, code: string): Promise<void> {
    this.mark(id, 'unknown', code);
  }
  async markFailed(id: string, code: string): Promise<void> {
    const row = this.rows.get(id);
    if (
      code === 'messaging_window_expired' &&
      row &&
      ['queued', 'retryable'].includes(row.deliveryState)
    ) {
      row.deliveryState = 'failed';
      row.lastErrorCode = code;
      return;
    }
    this.mark(id, 'failed', code);
  }
}
