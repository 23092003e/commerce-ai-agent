import { Pool } from 'pg';

export interface AdminConversationSummary {
  id: string;
  customer: string | null;
  controlMode: 'ai' | 'human' | 'paused';
  lastMessage: string | null;
  version: number;
}

export interface AdminOrderSummary {
  id: string;
  orderNumber: string;
  customer: string | null;
  status: string;
  total: string;
  currency: string;
  createdAt: string;
}

export interface AdminProductSummary {
  id: string;
  name: string;
  sku: string | null;
  status: string;
  price: string;
  currency: string;
  variantCount: number;
  availableInventory: number;
}

export interface AdminCustomerSummary {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  conversationCount: number;
}

export interface AdminKnowledgeDocumentSummary {
  id: string;
  title: string;
  sourceType: string;
  status: string;
  topics: string[];
  updatedAt: string;
}

export interface AdminAgentRunSummary {
  id: string;
  conversationId: string;
  customer: string | null;
  model: string;
  status: string;
  outcome: string | null;
  latencyMs: number | null;
  toolCallCount: number;
  startedAt: string;
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

  async listOrders(): Promise<AdminOrderSummary[]> {
    const result = await this.pool.query<AdminOrderSummary>(
      `SELECT o.id, o.order_number AS "orderNumber",
              COALESCE(cu.display_name, cu.meta_psid) AS customer,
              o.status, o.total::text AS total, o.currency,
              o.created_at::text AS "createdAt"
       FROM orders o
       JOIN customers cu ON cu.id = o.customer_id
       ORDER BY o.created_at DESC
       LIMIT 100`
    );
    return result.rows;
  }

  async listProducts(): Promise<AdminProductSummary[]> {
    const result = await this.pool.query<AdminProductSummary>(
      `SELECT p.id, p.name, p.sku, p.status, p.base_price::text AS price,
              p.currency, COUNT(v.id)::integer AS "variantCount",
              COALESCE(SUM(i.quantity_available - i.quantity_reserved), 0)::integer
                AS "availableInventory"
       FROM products p
       LEFT JOIN product_variants v ON v.product_id = p.id
       LEFT JOIN inventory i ON i.variant_id = v.id
       GROUP BY p.id
       ORDER BY p.updated_at DESC
       LIMIT 100`
    );
    return result.rows;
  }

  async listCustomers(): Promise<AdminCustomerSummary[]> {
    const result = await this.pool.query<AdminCustomerSummary>(
      `SELECT cu.id, cu.display_name AS name,
              CASE
                WHEN cu.phone IS NULL THEN NULL
                WHEN length(cu.phone) <= 4 THEN '***'
                ELSE '***' || right(cu.phone, 4)
              END AS phone,
              CASE
                WHEN cu.email IS NULL THEN NULL
                ELSE left(cu.email, 1) || '***'
              END AS email,
              COUNT(c.id)::integer AS "conversationCount"
       FROM customers cu
       LEFT JOIN conversations c ON c.customer_id = cu.id
       GROUP BY cu.id
       ORDER BY cu.updated_at DESC
       LIMIT 100`
    );
    return result.rows;
  }

  async listKnowledgeDocuments(): Promise<AdminKnowledgeDocumentSummary[]> {
    const result = await this.pool.query<AdminKnowledgeDocumentSummary>(
      `SELECT id, title, source_type AS "sourceType", status, topics,
              updated_at::text AS "updatedAt"
       FROM knowledge_documents
       ORDER BY updated_at DESC
       LIMIT 100`
    );
    return result.rows;
  }

  async listAgentRuns(): Promise<AdminAgentRunSummary[]> {
    const result = await this.pool.query<AdminAgentRunSummary>(
      `SELECT r.id, r.conversation_id AS "conversationId",
              COALESCE(cu.display_name, cu.meta_psid) AS customer,
              r.model_provider || '/' || r.model_name AS model,
              r.status, r.final_outcome AS outcome,
              r.latency_ms AS "latencyMs",
              COUNT(t.id)::integer AS "toolCallCount",
              r.started_at::text AS "startedAt"
       FROM agent_runs r
       JOIN conversations c ON c.id = r.conversation_id
       JOIN customers cu ON cu.id = c.customer_id
       LEFT JOIN tool_calls t ON t.agent_run_id = r.id
       GROUP BY r.id, cu.id
       ORDER BY r.started_at DESC
       LIMIT 100`
    );
    return result.rows;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
