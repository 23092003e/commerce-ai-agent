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

export class FakeMessagingChannel implements MessagingChannel {
  readonly sent: Array<SendTextInput & { messageId: string }> = [];

  async sendText(input: SendTextInput): Promise<SendResult> {
    const messageId = `fake-${randomUUID()}`;
    this.sent.push({ ...input, messageId });
    return { messageId, recipientId: input.recipientId };
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
    const response = await this.fetchImplementation(
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

    if (!response.ok) {
      throw new Error(`Meta Send API failed with status ${response.status}`);
    }

    const parsed = MetaSendResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error('Meta Send API returned an invalid response');
    }

    return {
      messageId: parsed.data.message_id,
      recipientId: parsed.data.recipient_id
    };
  }
}
