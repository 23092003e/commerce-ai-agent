import type { PoolClient } from 'pg';
import type { ConversationLeaseContext } from './types.js';

export async function lockConversation(
  client: PoolClient,
  id: string,
  lease?: ConversationLeaseContext
): Promise<void> {
  const identity = await client.query<{ key: string }>(
    `SELECT 'meta:' || p.meta_page_id || ':' || u.meta_psid AS key FROM conversations c JOIN pages p ON p.id=c.page_id JOIN customers u ON u.id=c.customer_id WHERE c.id=$1`,
    [id]
  );
  const key = identity.rows[0]?.key;
  if (!key) throw new Error('Conversation not found');
  if (lease) {
    if (lease.conversationKey !== key)
      throw new Error('Conversation lease mismatch');
    return;
  }
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    key
  ]);
}
