import {
  CheckoutDraftSchema,
  type CheckoutDraftRepository
} from '@fanpage/domain';
import { Pool } from 'pg';

interface DraftRow {
  conversation_id: string;
  version: number;
  checkout_state: string;
  recipient_name: string | null;
  phone: string | null;
  address: unknown;
  payment_method: string | null;
}

function asDraft(row: DraftRow) {
  return CheckoutDraftSchema.parse({
    conversationId: row.conversation_id,
    version: row.version,
    state: row.checkout_state,
    recipientName: row.recipient_name,
    phone: row.phone,
    address: row.address,
    paymentMethod: row.payment_method
  });
}

export class PostgresCheckoutDraftRepository implements CheckoutDraftRepository {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async get(conversationId: string) {
    const result = await this.pool.query<DraftRow>(
      `SELECT c.id AS conversation_id, c.version, c.checkout_state,
              d.recipient_name, d.phone, d.address, d.payment_method
       FROM conversations c
       LEFT JOIN checkout_drafts d ON d.conversation_id = c.id
       WHERE c.id = $1`,
      [conversationId]
    );
    const row = result.rows[0];
    return row ? asDraft(row) : null;
  }

  async update(input: Parameters<CheckoutDraftRepository['update']>[0]) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const conversation = await client.query<{ version: number }>(
        `UPDATE conversations
         SET checkout_state = $3, version = version + 1, updated_at = now()
         WHERE id = $1 AND version = $2
         RETURNING version`,
        [input.conversationId, input.expectedVersion, input.state]
      );
      if (!conversation.rows[0]) throw new Error('Checkout version conflict');
      await client.query(
        `INSERT INTO checkout_drafts (
           conversation_id, recipient_name, phone, address, payment_method
         ) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (conversation_id) DO UPDATE SET
           recipient_name = COALESCE(EXCLUDED.recipient_name, checkout_drafts.recipient_name),
           phone = COALESCE(EXCLUDED.phone, checkout_drafts.phone),
           address = COALESCE(EXCLUDED.address, checkout_drafts.address),
           payment_method = COALESCE(EXCLUDED.payment_method, checkout_drafts.payment_method),
           confirmation_id = NULL,
           confirmation_snapshot = NULL,
           updated_at = now()`,
        [
          input.conversationId,
          input.recipientName ?? null,
          input.phone ?? null,
          input.address ?? null,
          input.paymentMethod ?? null
        ]
      );
      const result = await client.query<DraftRow>(
        `SELECT c.id AS conversation_id, c.version, c.checkout_state,
                d.recipient_name, d.phone, d.address, d.payment_method
         FROM conversations c
         JOIN checkout_drafts d ON d.conversation_id = c.id
         WHERE c.id = $1`,
        [input.conversationId]
      );
      const row = result.rows[0];
      if (!row) throw new Error('Checkout draft was not persisted');
      await client.query('COMMIT');
      return asDraft(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
