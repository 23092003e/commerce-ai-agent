import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  runMigrations,
  PostgresConversationContextRepository,
  PostgresCartRepository,
  PostgresCheckoutDraftRepository
} from '../src/index.js';
import { PostgresConversationSummaryRepository } from '../src/conversation-summary-postgres.js';
import { seedCommerceFixture } from './commerce-fixture.js';
const url =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:54322/fanpage_sales_agent';
const pool = new Pool({ connectionString: url });
const context = new PostgresConversationContextRepository(url);
const carts = new PostgresCartRepository(url);
const checkout = new PostgresCheckoutDraftRepository(url);
const summaries = new PostgresConversationSummaryRepository(url);
beforeAll(async () => {
  await runMigrations(
    url,
    fileURLToPath(new URL('../migrations/', import.meta.url))
  );
});
afterAll(async () => {
  await Promise.all([
    pool.end(),
    context.close(),
    carts.close(),
    checkout.close(),
    summaries.close()
  ]);
});
it('loads current commerce state, chronological bounded history and ordered refs without checkout PII', async () => {
  const fixture = await seedCommerceFixture(pool);
  await carts.upsertLine({ ...fixture, quantity: 2 });
  await checkout.update({
    conversationId: fixture.conversationId,
    expectedVersion: 1,
    state: 'collecting_payment',
    recipientName: 'Lan',
    phone: '0901234567',
    address: {
      line1: 'Secret Lane',
      ward: 'Private ward',
      city: 'Private city'
    }
  });
  await pool.query(
    'UPDATE conversations SET current_product_refs=$2 WHERE id=$1',
    [
      fixture.conversationId,
      JSON.stringify({
        turnId: fixture.productId,
        items: [
          {
            position: 1,
            productId: fixture.productId,
            variantId: fixture.variantId
          }
        ]
      })
    ]
  );
  for (let i = 0; i < 20; i++)
    await pool.query(
      `INSERT INTO messages(conversation_id,direction,sender_type,message_type,text,delivery_state,created_at) VALUES ($1,$2,$3,'text',$4,$5,to_timestamp($6))`,
      [
        fixture.conversationId,
        i % 2 ? 'outbound' : 'inbound',
        i % 2 ? 'ai' : 'customer',
        `${String(i)} secret 0901234567 Secret Lane ${'x'.repeat(400)}`,
        i % 2 ? 'sent' : 'received',
        1000 + i
      ]
    );
  const result = await context.load({
    conversationId: fixture.conversationId,
    recentMessageLimit: 12,
    recentCharacterBudget: 4000
  });
  expect(result.recentMessages.length).toBeLessThanOrEqual(12);
  expect(
    result.recentMessages.reduce((sum, item) => sum + item.text.length, 0)
  ).toBeLessThanOrEqual(4000);
  expect(result.recentMessages.at(-1)?.text).toContain('19');
  expect(
    result.recentMessages.some((item) => item.direction === 'outbound')
  ).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(
    /0901234567|Secret Lane|Private ward|Private city/
  );
  expect(result.cart?.lines[0]?.quantity).toBe(2);
  expect(result.checkout).toMatchObject({
    state: 'collecting_payment',
    missingFields: ['paymentMethod']
  });
  expect(result.productReferences[0]?.productId).toBe(fixture.productId);
  expect(
    await summaries.refreshIfNeeded({
      conversationId: fixture.conversationId,
      context: { ...result, customerMessage: 'continue' }
    })
  ).toBe(true);
  const refreshed = await context.load({
    conversationId: fixture.conversationId,
    recentMessageLimit: 12,
    recentCharacterBudget: 4000
  });
  expect(refreshed.summary).toContain(fixture.productId);
  expect(refreshed.summary).not.toMatch(/0901234567|Secret Lane/);
  expect(
    await summaries.refreshIfNeeded({
      conversationId: fixture.conversationId,
      context: { ...refreshed, customerMessage: 'continue' }
    })
  ).toBe(false);
  expect(
    await summaries.refreshIfNeeded({
      conversationId: fixture.conversationId,
      context: {
        ...refreshed,
        controlMode: 'human',
        customerMessage: 'continue'
      },
      now: Date.now() + 86400000
    })
  ).toBe(false);
  await context.saveProductReferences({
    conversationId: fixture.conversationId,
    turnId: fixture.productId,
    items: [
      {
        position: 1,
        productId: fixture.productId,
        variantId: fixture.variantId
      }
    ]
  });
  await pool.query("UPDATE products SET status='archived' WHERE id=$1", [
    fixture.productId
  ]);
  await expect(
    context.saveProductReferences({
      conversationId: fixture.conversationId,
      turnId: fixture.productId,
      items: [
        {
          position: 1,
          productId: fixture.productId,
          variantId: fixture.variantId
        }
      ]
    })
  ).rejects.toThrow('invalid_product_reference');
});
