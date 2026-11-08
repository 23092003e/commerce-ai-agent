import { Pool } from 'pg';
import {
  createSafeConversationSummary,
  shouldRefreshSummary,
  type AgentContext
} from '@fanpage/domain';
export class PostgresConversationSummaryRepository {
  private readonly pool: Pool;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }
  async refreshIfNeeded(input: {
    conversationId: string;
    context: AgentContext;
    now?: number;
  }) {
    if (input.context.controlMode !== 'ai') return false;
    const now = input.now ?? Date.now();
    const row = (
      await this.pool.query<{
        version: number;
        summary_updated_at: Date | null;
        message_count: string;
      }>(
        `SELECT c.version,c.summary_updated_at,(SELECT count(*) FROM messages m WHERE m.conversation_id=c.id AND (c.summary_updated_at IS NULL OR m.created_at>c.summary_updated_at)) AS message_count FROM conversations c WHERE c.id=$1`,
        [input.conversationId]
      )
    ).rows[0];
    if (
      !row ||
      !shouldRefreshSummary(
        row.summary_updated_at?.getTime() ?? null,
        Number(row.message_count),
        now
      )
    )
      return false;
    const summary = JSON.stringify(
      createSafeConversationSummary(input.context)
    );
    const result = await this.pool.query(
      `UPDATE conversations SET last_summary=$3,summary_updated_at=$4 WHERE id=$1 AND version=$2 AND control_mode='ai'`,
      [input.conversationId, row.version, summary, new Date(now)]
    );
    return result.rowCount === 1;
  }
  async close() {
    await this.pool.end();
  }
}
