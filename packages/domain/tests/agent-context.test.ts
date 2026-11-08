import { describe, expect, it } from 'vitest';
import {
  assembleAgentContext,
  redactConversationText,
  boundRecentMessages
} from '../src/agent-context.js';
const message = {
  direction: 'inbound',
  senderType: 'customer',
  text: 'hello',
  createdAt: '2026-01-01T00:00:00.000Z'
} as const;
describe('bounded context', () => {
  it('rejects oversized or private transcript metadata', () => {
    for (const recentMessages of [
      Array(13).fill(message),
      [{ ...message, phone: '0900000000' }],
      [{ ...message, text: '0901234567' }],
      Array(12).fill({ ...message, text: 'a'.repeat(400) })
    ]) {
      expect(() =>
        assembleAgentContext({ customerMessage: 'hello', recentMessages })
      ).toThrow();
    }
    expect(() =>
      assembleAgentContext({
        customerMessage: 'hello',
        summary: 'x'.repeat(2001)
      })
    ).toThrow();
    expect(() =>
      assembleAgentContext({
        customerMessage: 'hello',
        checkout: {
          version: 1,
          state: 'collecting_phone',
          missingFields: [],
          phone: '0901234567'
        }
      })
    ).toThrow();
  });
  it('redacts contact details and bounds newest history in chronological order', () => {
    expect(
      redactConversationText('Call 0901234567 or lan@example.com')
    ).not.toMatch(/0901234567|lan@example/);
    expect(
      redactConversationText('My address is 12 Main Street, HCM')
    ).not.toContain('12 Main');
    expect(
      redactConversationText('deliver to Secret Lane', ['Secret Lane'])
    ).not.toContain('Secret Lane');
    const rows = Array.from({ length: 20 }, (_, i) => ({
      ...message,
      text: `${String(i)} ${'a'.repeat(400)}`
    }));
    const result = boundRecentMessages(rows);
    expect(result.length).toBeLessThanOrEqual(12);
    expect(
      result.reduce((sum, item) => sum + item.text.length, 0)
    ).toBeLessThanOrEqual(4000);
    expect(result.at(-1)?.text).toContain('19 ');
  });
});
