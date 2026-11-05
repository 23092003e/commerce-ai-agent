import { Pool } from 'pg';
import type {
  OutboundMessageRepository,
  OutboundMessageView,
  OutboundDeliveryState
} from './types.js';

interface OutboundRow {
  id: string;
  conversation_id: string;
  inbound_message_id: string;
  recipient_id: string;
  outbound_key: string;
  text: string;
  delivery_state: OutboundDeliveryState;
  attempts: number;
  last_error_code: string | null;
}
function view(row: OutboundRow): OutboundMessageView {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    inboundMessageId: row.inbound_message_id,
    recipientId: row.recipient_id,
    outboundKey: row.outbound_key,
    text: row.text,
    deliveryState: row.delivery_state,
    attempts: row.attempts,
    lastErrorCode: row.last_error_code
  };
}

export class PostgresOutboundMessageRepository implements OutboundMessageRepository {
  private readonly pool: Pool;
  constructor(url: string) {
    this.pool = new Pool({ connectionString: url });
  }
  async planText(
    input: Parameters<OutboundMessageRepository['planText']>[0]
  ): Promise<OutboundMessageView> {
    const result = await this.pool.query<OutboundRow>(
      `INSERT INTO messages(conversation_id,inbound_message_id,recipient_id,outbound_key,text,direction,sender_type,message_type,delivery_state) VALUES($1,$2,$3,$4,$5,'outbound','ai','text','queued') ON CONFLICT(outbound_key) WHERE outbound_key IS NOT NULL DO UPDATE SET outbound_key=EXCLUDED.outbound_key RETURNING *`,
      [
        input.conversationId,
        input.inboundMessageId,
        input.recipientId,
        input.outboundKey,
        input.text
      ]
    );
    const row = result.rows[0];
    if (!row) throw new Error('Outbound plan missing');
    return view(row);
  }
  async findByInboundMessage(id: string): Promise<OutboundMessageView | null> {
    const result = await this.pool.query<OutboundRow>(
      'SELECT * FROM messages WHERE inbound_message_id=$1 ORDER BY created_at LIMIT 1',
      [id]
    );
    return result.rows[0] ? view(result.rows[0]) : null;
  }
  async claimForSend(
    id: string
  ): Promise<'claimed' | 'already_sent' | 'uncertain' | 'suppressed'> {
    const result = await this.pool.query(
      `UPDATE messages m SET delivery_state='sending', attempts=attempts+1, delivery_updated_at=now() WHERE id=$1 AND delivery_state IN ('queued','retryable') AND EXISTS (SELECT 1 FROM conversations c WHERE c.id=m.conversation_id AND c.control_mode='ai') RETURNING id`,
      [id]
    );
    if (result.rowCount) return 'claimed';
    const current = await this.pool.query<{
      delivery_state: string;
      control_mode: string;
      last_error_code: string | null;
    }>(
      'SELECT m.delivery_state,m.last_error_code,c.control_mode FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.id=$1',
      [id]
    );
    const row = current.rows[0];
    if (!row) throw new Error('Outbound message not found');
    if (['sent', 'delivered'].includes(row.delivery_state))
      return 'already_sent';
    if (row.delivery_state === 'sending')
      await this.markUnknown(id, 'interrupted_send', 'Delivery interrupted');
    if (
      ['queued', 'retryable'].includes(row.delivery_state) &&
      row.control_mode !== 'ai'
    ) {
      await this.pool.query(
        `UPDATE messages SET delivery_state='failed',last_error_code=$2,delivery_updated_at=now() WHERE id=$1 AND delivery_state IN ('queued','retryable')`,
        [id, row.control_mode === 'human' ? 'human_controlled' : 'paused']
      );
      return 'suppressed';
    }
    if (
      row.delivery_state === 'failed' &&
      ['human_controlled', 'paused'].includes(row.last_error_code ?? '')
    )
      return 'suppressed';
    return 'uncertain';
  }
  async markSent(id: string, metaMessageId: string): Promise<void> {
    await this.pool.query(
      `UPDATE messages SET delivery_state='sent', meta_message_id=$2,sent_at=now(),delivery_updated_at=now() WHERE id=$1 AND delivery_state='sending'`,
      [id, metaMessageId]
    );
  }
  private async mark(
    id: string,
    state: string,
    code: string,
    message: string
  ): Promise<void> {
    await this.pool.query(
      `UPDATE messages SET delivery_state=$2::message_delivery_state,last_error_code=$3,last_error=$4,delivery_updated_at=now() WHERE id=$1 AND delivery_state='sending'`,
      [id, state, code.slice(0, 100), message.slice(0, 500)]
    );
  }
  async markRetryable(
    id: string,
    code: string,
    message: string
  ): Promise<void> {
    await this.mark(id, 'retryable', code, message);
  }
  async markUnknown(id: string, code: string, message: string): Promise<void> {
    await this.mark(id, 'unknown', code, message);
  }
  async markFailed(id: string, code: string, message: string): Promise<void> {
    if (code === 'messaging_window_expired') {
      await this.pool.query(
        `UPDATE messages SET delivery_state='failed',last_error_code=$2,last_error=$3,delivery_updated_at=now() WHERE id=$1 AND delivery_state IN ('queued','retryable')`,
        [id, code, message.slice(0, 500)]
      );
      return;
    }
    await this.mark(id, 'failed', code, message);
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
}
