import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PostgresHandoverRepository, runMigrations } from '../src/index.js';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:54322/fanpage_sales_agent';
const repository = new PostgresHandoverRepository(databaseUrl);
const pool = new Pool({ connectionString: databaseUrl });
beforeAll(async () => {
  await runMigrations(
    databaseUrl,
    fileURLToPath(new URL('../migrations/', import.meta.url))
  );
});
afterAll(async () => {
  await repository.close();
  await pool.end();
});
describe('Postgres handover', () => {
  it('centralizes admin transitions, validates versions and audits without leaving open records', async () => {
    const suffix = randomUUID();
    const seeded = await pool.query<{ id: string; version: number }>(
      `WITH p AS (INSERT INTO pages(meta_page_id,name) VALUES($1,'control') RETURNING id), c AS (INSERT INTO customers(page_id,meta_psid) SELECT id,$1 FROM p RETURNING id,page_id) INSERT INTO conversations(page_id,customer_id) SELECT page_id,id FROM c RETURNING id,version`,
      [suffix]
    );
    const conversation = seeded.rows[0];
    if (!conversation) throw new Error('Conversation missing');
    const takeover = await repository.takeOver({
      conversationId: conversation.id,
      expectedVersion: conversation.version,
      adminActor: 'test-admin'
    });
    expect(takeover.type).toBe('updated');
    expect(
      await repository.pause({
        conversationId: conversation.id,
        expectedVersion: conversation.version,
        adminActor: 'test-admin'
      })
    ).toMatchObject({ type: 'conflict' });
    const current = await pool.query<{ version: number }>(
      'SELECT version FROM conversations WHERE id=$1',
      [conversation.id]
    );
    const paused = await repository.pause({
      conversationId: conversation.id,
      expectedVersion: current.rows[0]?.version ?? 0,
      adminActor: 'test-admin'
    });
    expect(paused.type).toBe('updated');
    const beforeResolve = await pool.query<{ version: number }>(
      'SELECT version FROM conversations WHERE id=$1',
      [conversation.id]
    );
    expect(
      await repository.resolveToAi({
        conversationId: conversation.id,
        expectedVersion: beforeResolve.rows[0]?.version ?? 0,
        adminActor: 'test-admin'
      })
    ).toMatchObject({ type: 'updated', conversation: { controlMode: 'ai' } });
    const open = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM handovers WHERE conversation_id=$1 AND status IN ('pending','active')",
      [conversation.id]
    );
    expect(open.rows[0]?.count).toBe(0);
    const audit = await pool.query<{ actor: string; action: string }>(
      'SELECT actor,action FROM admin_audit_logs WHERE target_id=$1 ORDER BY created_at,id',
      [conversation.id]
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      'take_over',
      'pause',
      'resolve_to_ai'
    ]);
    expect(audit.rows.every((row) => row.actor === 'test-admin')).toBe(true);
  });
  it('moves control from AI to human and explicitly back', async () => {
    const suffix = randomUUID();
    const seeded = await pool.query<{ id: string; version: number }>(
      `WITH p AS (INSERT INTO pages (meta_page_id, name) VALUES ($1, 'Handover') RETURNING id), c AS (INSERT INTO customers (page_id, meta_psid) SELECT id, $2 FROM p RETURNING id, page_id) INSERT INTO conversations (page_id, customer_id) SELECT page_id, id FROM c RETURNING id, version`,
      [`handover-page-${suffix}`, `handover-customer-${suffix}`]
    );
    const conversation = seeded.rows[0];
    if (!conversation) throw new Error('Conversation missing');
    const requested = await repository.request({
      conversationId: conversation.id,
      expectedVersion: conversation.version,
      reason: 'customer_requested'
    });
    expect(requested.version).toBe(conversation.version + 1);
    expect(
      await repository.request({
        conversationId: conversation.id,
        expectedVersion: conversation.version,
        reason: 'delivery_retry'
      })
    ).toEqual(requested);
    const handoverCount = await pool.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM handovers WHERE conversation_id=$1',
      [conversation.id]
    );
    expect(handoverCount.rows[0]?.count).toBe(1);
    await expect(
      repository.resolve({
        conversationId: conversation.id,
        expectedVersion: requested.version
      })
    ).resolves.toEqual({ version: requested.version + 1 });
    const final = await pool.query<{ control_mode: string }>(
      'SELECT control_mode FROM conversations WHERE id = $1',
      [conversation.id]
    );
    expect(final.rows[0]?.control_mode).toBe('ai');
  });
});
