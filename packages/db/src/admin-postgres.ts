import { Pool } from 'pg';

export interface AdminConversationSummary {
  id: string;
  customer: string | null;
  controlMode: 'ai' | 'human' | 'paused';
  lastMessage: string | null;
  version: number;
}

export class PostgresAdminRepository {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async listConversations(): Promise<AdminConversationSummary[]> {
    const result = await this.pool.query<AdminConversationSummary>(
      `SELECT c.id, COALESCE(cu.display_name, cu.meta_psid) AS customer,
              c.control_mode AS "controlMode", m.text AS "lastMessage", c.version
       FROM conversations c
       JOIN customers cu ON cu.id = c.customer_id
       LEFT JOIN LATERAL (
         SELECT text FROM messages WHERE conversation_id = c.id
         ORDER BY created_at DESC LIMIT 1
       ) m ON true
       ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC
       LIMIT 100`
    );
    return result.rows;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
