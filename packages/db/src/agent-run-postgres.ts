import { eq, sql } from 'drizzle-orm';
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
  step?: number;
  resultRefIds?: string[];
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
    return (await this.startOrResume(input)).id;
  }

  async startOrResume(
    input: StartAgentRunInput
  ): Promise<{ id: string; resumed: boolean; finalOutcome: string | null }> {
    const [run] = await this.db
      .insert(schema.agentRuns)
      .values(input)
      .onConflictDoNothing({ target: schema.agentRuns.inboundMessageId })
      .returning({ id: schema.agentRuns.id });
    if (run) return { id: run.id, resumed: false, finalOutcome: null };
    const [existing] = await this.db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.inboundMessageId, input.inboundMessageId))
      .limit(1);
    if (!existing) throw new Error('Agent run was not found');
    return {
      id: existing.id,
      resumed: true,
      finalOutcome: existing.finalOutcome
    };
  }

  async recordToolCall(input: RecordToolCallInput): Promise<void> {
    const { step, resultRefIds, ...record } = input;
    const resultSummary = { ...record.resultSummary };
    for (const [index, id] of (resultRefIds ?? []).slice(0, 220).entries())
      resultSummary[`ref${String(index)}`] = id.slice(0, 200);
    await this.db
      .insert(schema.toolCalls)
      .values({
        ...record,
        resultSummary,
        step:
          step ??
          sql`(SELECT COALESCE(MAX(step), 0) + 1 FROM tool_calls WHERE agent_run_id = ${input.agentRunId})`
      })
      .onConflictDoNothing({
        target: [schema.toolCalls.agentRunId, schema.toolCalls.step]
      });
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
      .where(eq(schema.agentRuns.id, input.agentRunId));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
