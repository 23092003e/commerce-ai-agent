import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export interface SendTextInput {
  recipientId: string;
  text: string;
}

export interface SendResult {
  messageId: string;
  recipientId: string;
}

export interface MessagingChannel {
  sendText(input: SendTextInput): Promise<SendResult>;
}

export type MetaChannelErrorCode =
  | 'authentication'
  | 'invalid_request'
  | 'rate_limited'
  | 'server_error'
  | 'invalid_response'
  | 'timeout'
  | 'network';

export class MetaChannelError extends Error {
  override readonly name = 'MetaChannelError';

  constructor(
    message: string,
    readonly code: MetaChannelErrorCode,
    readonly retryable: boolean,
    readonly status?: number
  ) {
    super(message);
  }
}

export class FakeMessagingChannel implements MessagingChannel {
  readonly sent: Array<SendTextInput & { messageId: string }> = [];

  async sendText(input: SendTextInput): Promise<SendResult> {
    const messageId = `fake-${randomUUID()}`;
    this.sent.push({ ...input, messageId });
    return { messageId, recipientId: input.recipientId };
  }

  getCapturedMessages(): ReadonlyArray<SendTextInput & { messageId: string }> {
    return structuredClone(this.sent);
  }
}

const MetaSendResponseSchema = z.object({
  message_id: z.string().min(1),
  recipient_id: z.string().min(1)
});

export interface MetaGraphChannelOptions {
  accessToken: string;
  apiVersion: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
}

export class MetaGraphMessagingChannel implements MessagingChannel {
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: MetaGraphChannelOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async sendText(input: SendTextInput): Promise<SendResult> {
    let response: Response;
    try {
      response = await this.fetchImplementation(
        `https://graph.facebook.com/${encodeURIComponent(this.options.apiVersion)}/me/messages`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.options.accessToken}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            messaging_type: 'RESPONSE',
            recipient: { id: input.recipientId },
            message: { text: input.text }
          }),
          signal: AbortSignal.timeout(this.timeoutMs)
        }
      );
    } catch (error) {
      const isTimeout =
        error instanceof DOMException &&
        (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new MetaChannelError(
        isTimeout ? 'Meta Send API timed out' : 'Meta Send API network failure',
        isTimeout ? 'timeout' : 'network',
        true
      );
    }

    if (!response.ok) {
      const code: MetaChannelErrorCode =
        response.status === 401 || response.status === 403
          ? 'authentication'
          : response.status === 429
            ? 'rate_limited'
            : response.status >= 500
              ? 'server_error'
              : 'invalid_request';
      throw new MetaChannelError(
        `Meta Send API failed with status ${String(response.status)}`,
        code,
        response.status === 429 || response.status >= 500,
        response.status
      );
    }

    const parsed = MetaSendResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new MetaChannelError(
        'Meta Send API returned an invalid response',
        'invalid_response',
        false,
        response.status
      );
    }

    return {
      messageId: parsed.data.message_id,
      recipientId: parsed.data.recipient_id
    };
  }
}
