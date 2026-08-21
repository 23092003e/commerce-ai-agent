import { describe, expect, it, vi } from 'vitest';
import { MetaChannelError, MetaGraphMessagingChannel } from '../src/index.js';

function createChannel(fetchImplementation: typeof fetch) {
  return new MetaGraphMessagingChannel({
    accessToken: 'secret-token',
    apiVersion: 'v23.0',
    fetchImplementation
  });
}

describe('Meta Graph messaging contract', () => {
  it('projects a successful text-send response', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ message_id: 'mid.123', recipient_id: 'psid.456' }),
          { status: 200 }
        )
      );

    await expect(
      createChannel(fetchMock).sendText({ recipientId: 'psid.456', text: 'Hi' })
    ).resolves.toEqual({ messageId: 'mid.123', recipientId: 'psid.456' });
  });

  it.each([
    [400, 'invalid_request', false],
    [401, 'authentication', false],
    [429, 'rate_limited', true],
    [500, 'server_error', true]
  ] as const)(
    'classifies HTTP %s as %s with retryable=%s',
    async (status, code, retryable) => {
      const channel = createChannel(
        vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status }))
      );

      const error = await channel
        .sendText({ recipientId: 'psid.456', text: 'Hi' })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(MetaChannelError);
      expect(error).toMatchObject({ code, retryable, status });
    }
  );

  it('classifies a transport timeout as retryable', async () => {
    const channel = createChannel(
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    );

    const error = await channel
      .sendText({ recipientId: 'psid.456', text: 'Hi' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MetaChannelError);
    expect(error).toMatchObject({ code: 'timeout', retryable: true });
  });
});
