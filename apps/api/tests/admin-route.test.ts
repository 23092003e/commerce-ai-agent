import { InMemoryCommerceRepository } from '@fanpage/db';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
const secret = '01234567890123456789012345678901';
const conversationId = '11111111-1111-4111-8111-111111111111';
describe('admin conversation control route', () => {
  it('requires auth before calling the control repository', async () => {
    const repository = new InMemoryCommerceRepository();
    const app = buildApp({
      config: {
        metaAppSecret: 'a'.repeat(16),
        metaVerifyToken: 'b'.repeat(16)
      },
      admin: { secret, repository }
    });
    const url = `/internal/admin/conversations/${conversationId}/control`;
    const denied = await app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ expectedVersion: 1, controlMode: 'human' })
    });
    expect(denied.statusCode).toBe(401);
    const missing = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json'
      },
      payload: JSON.stringify({ expectedVersion: 1, controlMode: 'human' })
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});

describe('admin conversations route', () => {
  it('returns operational conversations only to an authorized admin', async () => {
    const repository = new InMemoryCommerceRepository();
    const app = buildApp({
      config: {
        metaAppSecret: 'a'.repeat(16),
        metaVerifyToken: 'b'.repeat(16)
      },
      admin: {
        secret,
        repository,
        data: {
          async listConversations() {
            return [
              {
                id: conversationId,
                customer: 'Lan',
                controlMode: 'ai',
                lastMessage: 'Need a cake',
                version: 2
              }
            ];
          }
        }
      }
    });

    const denied = await app.inject({
      method: 'GET',
      url: '/internal/admin/conversations'
    });
    expect(denied.statusCode).toBe(401);

    const accepted = await app.inject({
      method: 'GET',
      url: '/internal/admin/conversations',
      headers: { authorization: `Bearer ${secret}` }
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({
      conversations: [
        {
          id: conversationId,
          customer: 'Lan',
          controlMode: 'ai',
          lastMessage: 'Need a cake',
          version: 2
        }
      ]
    });
    await app.close();
  });

  it('returns a redacted conversation timeline only to an authorized admin', async () => {
    const repository = new InMemoryCommerceRepository();
    const app = buildApp({
      config: {
        metaAppSecret: 'a'.repeat(16),
        metaVerifyToken: 'b'.repeat(16)
      },
      admin: {
        secret,
        repository,
        data: {
          async listConversations() {
            return [];
          },
          async getConversationMessages(id) {
            if (id !== conversationId) return null;
            return [
              {
                id: 'message-1',
                senderType: 'customer',
                text: 'I need a cake for Saturday.',
                deliveryState: 'received',
                createdAt: '2026-09-07T00:00:00.000Z'
              }
            ];
          }
        }
      }
    });
    const url = `/internal/admin/conversations/${conversationId}/messages`;
    const denied = await app.inject({ method: 'GET', url });
    expect(denied.statusCode).toBe(401);
    const accepted = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${secret}` }
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({
      messages: [
        {
          id: 'message-1',
          senderType: 'customer',
          text: 'I need a cake for Saturday.',
          deliveryState: 'received',
          createdAt: '2026-09-07T00:00:00.000Z'
        }
      ]
    });
    await app.close();
  });
});

describe('admin operational data routes', () => {
  it('exposes only approved operational summaries to an authorized admin', async () => {
    const repository = new InMemoryCommerceRepository();
    const app = buildApp({
      config: {
        metaAppSecret: 'a'.repeat(16),
        metaVerifyToken: 'b'.repeat(16)
      },
      admin: {
        secret,
        repository,
        data: {
          async listConversations() {
            return [];
          },
          async listOrders() {
            return [
              {
                id: 'order-1',
                orderNumber: 'ORD-1001',
                customer: 'Lan',
                status: 'confirmed',
                total: '450000',
                currency: 'VND',
                createdAt: '2026-09-07T00:00:00.000Z'
              }
            ];
          },
          async listProducts() {
            return [
              {
                id: 'product-1',
                name: 'Signature Cake',
                sku: 'CAKE-001',
                status: 'active',
                price: '450000',
                currency: 'VND',
                variantCount: 2,
                availableInventory: 8
              }
            ];
          },
          async listCustomers() {
            return [
              {
                id: 'customer-1',
                name: 'Lan',
                phone: '***1234',
                email: null,
                conversationCount: 1
              }
            ];
          },
          async listKnowledgeDocuments() {
            return [
              {
                id: 'knowledge-1',
                title: 'Shipping policy',
                sourceType: 'policy',
                status: 'active',
                topics: ['shipping'],
                updatedAt: '2026-09-07T00:00:00.000Z'
              }
            ];
          },
          async listAgentRuns() {
            return [
              {
                id: 'run-1',
                conversationId,
                customer: 'Lan',
                model: 'deepseek',
                status: 'completed',
                outcome: 'replied',
                latencyMs: 650,
                toolCallCount: 2,
                startedAt: '2026-09-07T00:00:00.000Z'
              }
            ];
          }
        }
      }
    });

    const denied = await app.inject({
      method: 'GET',
      url: '/internal/admin/orders'
    });
    expect(denied.statusCode).toBe(401);

    const expected = [
      ['/internal/admin/orders', 'ORD-1001'],
      ['/internal/admin/products', 'Signature Cake'],
      ['/internal/admin/customers', '***1234'],
      ['/internal/admin/knowledge', 'Shipping policy'],
      ['/internal/admin/agent-runs', 'deepseek']
    ] as const;
    for (const [url, expectedValue] of expected) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${secret}` }
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain(expectedValue);
    }
    await app.close();
  });

  it('accepts an authorized knowledge re-index request', async () => {
    const repository = new InMemoryCommerceRepository();
    let input: unknown;
    const app = buildApp({
      config: {
        metaAppSecret: 'a'.repeat(16),
        metaVerifyToken: 'b'.repeat(16)
      },
      admin: {
        secret,
        repository,
        knowledge: {
          async ingest(value) {
            input = value;
            return { type: 'created', documentId: 'knowledge-1' };
          }
        }
      }
    });
    const payload = {
      title: 'Shipping policy',
      sourceType: 'policy',
      content: 'Orders are delivered in two business days.',
      topics: ['shipping']
    };
    const denied = await app.inject({
      method: 'POST',
      url: '/internal/admin/knowledge',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(payload)
    });
    expect(denied.statusCode).toBe(401);
    const accepted = await app.inject({
      method: 'POST',
      url: '/internal/admin/knowledge',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json'
      },
      payload: JSON.stringify(payload)
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json()).toEqual({
      type: 'created',
      documentId: 'knowledge-1'
    });
    expect(input).toEqual(payload);
    await app.close();
  });
});
