import { expect, it } from 'vitest';
import {
  ConversationSummarySchema,
  shouldRefreshSummary,
  createSafeConversationSummary
} from '../src/conversation-summary.js';
import { assembleAgentContext } from '../src/agent-context.js';
it('refreshes at either threshold and keeps unsafe facts out of summaries', () => {
  expect(shouldRefreshSummary(1000, 11, 2000)).toBe(false);
  expect(shouldRefreshSummary(1000, 12, 2000)).toBe(true);
  expect(shouldRefreshSummary(1000, 0, 1000 + 86400000)).toBe(true);
  for (const goal of [
    'phone 0901234567',
    'lan@example.com',
    'address 12 Main Street',
    'price 120000 VND',
    'stock 5',
    'quantity 3',
    'order confirmed'
  ])
    expect(
      ConversationSummarySchema.safeParse({
        goal,
        constraints: [],
        preferences: [],
        discussedProductIds: [],
        unresolvedQuestions: []
      }).success
    ).toBe(false);
  const summary = createSafeConversationSummary(
    assembleAgentContext({ customerMessage: '0901234567 and price 120000' })
  );
  expect(JSON.stringify(summary)).not.toContain('0901234567');
  expect(JSON.stringify(summary).length).toBeLessThanOrEqual(2000);
});
