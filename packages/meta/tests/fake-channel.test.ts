import { describe, expect, it } from 'vitest';
import { FakeMessagingChannel } from '../src/index.js';

describe('Fake Meta channel', () => {
  it('captures outbound text without Meta credentials', async () => {
    const channel = new FakeMessagingChannel();

    const result = await channel.sendText({
      recipientId: 'customer-456',
      text: 'Xin chào!'
    });

    expect(result.recipientId).toBe('customer-456');
    expect(channel.sent).toMatchObject([
      { recipientId: 'customer-456', text: 'Xin chào!' }
    ]);
  });
});
