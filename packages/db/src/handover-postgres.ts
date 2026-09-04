import { Pool } from 'pg';

export class PostgresHandoverRepository {
  private readonly pool: Pool;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }
  async request(input: {
    conversationId: string;
    expectedVersion: number;
    reason: string;
  }): Promise<{ handoverId: string; version: number }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const handover = await client.query<{ id: string }>(
        `INSERT INTO handovers (conversation_id, reason) VALUES ($1, $2) RETURNING id`,
        [input.conversationId, input.reason]
      );
      const handoverId = handover.rows[0]?.id;
      if (!handoverId) throw new Error('Handover was not created');
      const conversation = await client.query<{ version: number }>(
        `UPDATE conversations SET control_mode = 'human', version = version + 1, updated_at = now() WHERE id = $1 AND version = $2 AND control_mode <> 'human' RETURNING version`,
        [input.conversationId, input.expectedVersion]
      );
      const version = conversation.rows[0]?.version;
      if (!version) throw new Error('Conversation control version conflict');
      await client.query('COMMIT');
      return { handoverId, version };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async resolve(input: {
    conversationId: string;
    expectedVersion: number;
  }): Promise<{ version: number }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const resolved = await client.query(
        `UPDATE handovers SET status = 'resolved', resolved_at = now(), updated_at = now() WHERE conversation_id = $1 AND status IN ('pending','active')`,
        [input.conversationId]
      );
      if (resolved.rowCount !== 1)
        throw new Error('Open handover was not found');
      const conversation = await client.query<{ version: number }>(
        `UPDATE conversations SET control_mode = 'ai', version = version + 1, updated_at = now() WHERE id = $1 AND version = $2 AND control_mode = 'human' RETURNING version`,
        [input.conversationId, input.expectedVersion]
      );
      const version = conversation.rows[0]?.version;
      if (!version) throw new Error('Conversation control version conflict');
      await client.query('COMMIT');
      return { version };
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
