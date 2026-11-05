import { Pool } from 'pg';
import {
  DomainError,
  type AdminControlInput,
  type ConversationControlResult,
  type ConversationControlService,
  type ControlConversationView
} from '@fanpage/domain';
import { lockConversation } from './conversation-lock.js';
import type { ConversationLeaseContext } from './types.js';

interface ControlRow {
  id: string;
  page_id: string;
  customer_id: string;
  status: 'open' | 'closed';
  control_mode: 'ai' | 'human' | 'paused';
  version: number;
}
function view(row: ControlRow): ControlConversationView {
  return {
    id: row.id,
    pageId: row.page_id,
    customerId: row.customer_id,
    status: row.status,
    controlMode: row.control_mode,
    version: row.version
  };
}

export class PostgresHandoverRepository implements ConversationControlService {
  private readonly pool: Pool;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  private async transition(
    input: {
      conversationId: string;
      mode: 'ai' | 'human' | 'paused';
      expectedVersion?: number;
      actor?: string;
      action: string;
      reason?: string;
    },
    lease?: ConversationLeaseContext
  ): Promise<ConversationControlResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const exists = await client.query(
        'SELECT id FROM conversations WHERE id=$1',
        [input.conversationId]
      );
      if (!exists.rowCount) {
        await client.query('ROLLBACK');
        return { type: 'not_found' };
      }
      await lockConversation(client, input.conversationId, lease);
      const current = await client.query<ControlRow>(
        'SELECT * FROM conversations WHERE id=$1 FOR UPDATE',
        [input.conversationId]
      );
      const before = current.rows[0];
      if (!before) {
        await client.query('ROLLBACK');
        return { type: 'not_found' };
      }
      if (
        input.expectedVersion !== undefined &&
        before.version !== input.expectedVersion
      ) {
        await client.query('ROLLBACK');
        return { type: 'conflict', currentVersion: before.version };
      }
      if (before.status !== 'open') {
        await client.query('ROLLBACK');
        return { type: 'invalid_transition' };
      }
      if (input.mode === 'human') {
        const open = await client.query<{ id: string }>(
          "SELECT id FROM handovers WHERE conversation_id=$1 AND status IN ('pending','active') ORDER BY created_at,id FOR UPDATE",
          [input.conversationId]
        );
        if (!open.rowCount)
          await client.query(
            'INSERT INTO handovers(conversation_id,reason) VALUES($1,$2)',
            [
              input.conversationId,
              (input.reason ?? 'admin_takeover').slice(0, 500)
            ]
          );
        if ((open.rowCount ?? 0) > 1 && open.rows[0])
          await client.query(
            "UPDATE handovers SET status='resolved',resolved_at=now(),updated_at=now() WHERE conversation_id=$1 AND status IN ('pending','active') AND id<>$2",
            [input.conversationId, open.rows[0].id]
          );
      } else if (input.mode === 'ai') {
        await client.query(
          "UPDATE handovers SET status='resolved',resolved_at=now(),updated_at=now() WHERE conversation_id=$1 AND status IN ('pending','active')",
          [input.conversationId]
        );
      }
      const changed = before.control_mode !== input.mode;
      const updated = await client.query<ControlRow>(
        'UPDATE conversations SET control_mode=$2,version=version+$3,updated_at=now() WHERE id=$1 RETURNING *',
        [input.conversationId, input.mode, changed ? 1 : 0]
      );
      const after = updated.rows[0];
      if (!after) throw new Error('Conversation update failed');
      if (input.actor)
        await client.query(
          'INSERT INTO admin_audit_logs(actor,action,target_id,before_state,after_state) VALUES($1,$2,$3,$4,$5)',
          [
            input.actor.slice(0, 100),
            input.action,
            input.conversationId,
            JSON.stringify({
              controlMode: before.control_mode,
              version: before.version
            }),
            JSON.stringify({
              controlMode: after.control_mode,
              version: after.version
            })
          ]
        );
      await client.query('COMMIT');
      return { type: 'updated', conversation: view(after) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async requestHandover(
    input: Parameters<ConversationControlService['requestHandover']>[0],
    lease?: ConversationLeaseContext
  ): Promise<ConversationControlResult> {
    return this.transition(
      {
        conversationId: input.conversationId,
        mode: 'human',
        action: 'request_handover',
        reason: input.reasonText
          ? `${input.reasonCode}: ${input.reasonText}`
          : input.reasonCode
      },
      lease
    );
  }
  async takeOver(
    input: AdminControlInput,
    lease?: ConversationLeaseContext
  ): Promise<ConversationControlResult> {
    return this.transition(
      { ...input, actor: input.adminActor, action: 'take_over', mode: 'human' },
      lease
    );
  }
  async resolveToAi(
    input: AdminControlInput,
    lease?: ConversationLeaseContext
  ): Promise<ConversationControlResult> {
    return this.transition(
      {
        ...input,
        actor: input.adminActor,
        action: 'resolve_to_ai',
        mode: 'ai'
      },
      lease
    );
  }
  async pause(
    input: AdminControlInput,
    lease?: ConversationLeaseContext
  ): Promise<ConversationControlResult> {
    return this.transition(
      { ...input, actor: input.adminActor, action: 'pause', mode: 'paused' },
      lease
    );
  }

  /** Compatibility adapter: agent versions are deliberately ignored. */
  async request(input: {
    conversationId: string;
    expectedVersion: number;
    reason: string;
    lease?: ConversationLeaseContext | undefined;
    outboundMessageId?: string | undefined;
  }): Promise<{ handoverId: string; version: number }> {
    const result = await this.requestHandover(
      {
        conversationId: input.conversationId,
        reasonCode: input.reason,
        ...(input.outboundMessageId
          ? { reasonText: `outbound_message_id=${input.outboundMessageId}` }
          : {}),
        source: 'agent'
      },
      input.lease
    );
    if (result.type !== 'updated')
      throw new DomainError(
        result.type === 'not_found' ? 'not_found' : 'invalid_transition'
      );
    const open = await this.pool.query<{ id: string }>(
      'SELECT id FROM handovers WHERE conversation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',
      [input.conversationId]
    );
    if (!open.rows[0]) throw new Error('Handover missing');
    return {
      handoverId: open.rows[0].id,
      version: result.conversation.version
    };
  }
  async resolve(input: {
    conversationId: string;
    expectedVersion: number;
    lease?: ConversationLeaseContext | undefined;
  }): Promise<{ version: number }> {
    const result = await this.resolveToAi(
      { ...input, adminActor: 'demo-admin' },
      input.lease
    );
    if (result.type === 'conflict') throw new DomainError('version_conflict');
    if (result.type !== 'updated')
      throw new DomainError(
        result.type === 'not_found' ? 'not_found' : 'invalid_transition'
      );
    return { version: result.conversation.version };
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
}
