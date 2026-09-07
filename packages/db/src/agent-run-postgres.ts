import { and, eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

type SafeTraceValue = string | number | boolean | null;
type SafeTraceProjection = Record<string, SafeTraceValue>;

export interface StartAgentRunInput {
  conversationId: string;
  inboundMessageId: string;
  modelProvider: string;
  modelName: string;
  promptVersion: string;
}
export interface CompleteAgentRunInput {
  agentRunId: string;
  outcome: 'replied' | 'handed_over' | 'no_action' | 'failed';
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}
export interface RecordToolCallInput {
  agentRunId: string;
  toolName: string;
  arguments: SafeTraceProjection;
  resultSummary: SafeTraceProjection;
  status: 'succeeded' | 'failed';
  latencyMs: number;
}

export class PostgresAgentRunRepository {
  private readonly pool: Pool;
  private readonly db: NodePgDatabase<typeof schema>;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
    this.db = drizzle(this.pool, { schema });
  }

  async start(input: StartAgentRunInput): Promise<string> {
    const [run] = await this.db
      .insert(schema.agentRuns)
      .values(input)
      .returning({ id: schema.agentRuns.id });
    if (!run) throw new Error('Agent run was not created');
    return run.id;
  }

  async recordToolCall(input: RecordToolCallInput): Promise<void> {
    await this.db.insert(schema.toolCalls).values(input);
  }

  async complete(input: CompleteAgentRunInput): Promise<void> {
    await this.db
      .update(schema.agentRuns)
      .set({
        status: input.outcome === 'failed' ? 'failed' : 'completed',
        finalOutcome: input.outcome,
        latencyMs: input.latencyMs,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        error: input.error,
        completedAt: new Date()
      })
      .where(
        and(
          eq(schema.agentRuns.id, input.agentRunId),
          eq(schema.agentRuns.status, 'running')
        )
      );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
