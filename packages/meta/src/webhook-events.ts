import { createHash } from 'node:crypto';
import type { MetaWebhookPayload } from './webhook-schema.js';

export interface MetaWebhookEventEnvelope {
  externalEventKey: string;
  metaPageId: string;
  eventTimestamp: number;
  rawPayload: unknown;
}

export interface InboundTextMessage {
  metaPageId: string;
  metaPsid: string;
  metaMessageId: string;
  text: string;
  timestamp: number;
  payload: unknown;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }

  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }

  const serialized = JSON.stringify(value);
  return typeof serialized === 'string' ? serialized : 'null';
}

export function extractMetaWebhookEvents(
  payload: MetaWebhookPayload
): MetaWebhookEventEnvelope[] {
  return payload.entry.flatMap((entry) =>
    entry.messaging.map((event) => {
      const messageId = event.message?.mid;
      const fallback = createHash('sha256')
        .update(
          [
            entry.id,
            event.sender.id,
            String(event.timestamp),
            event.message ? 'message' : 'unknown',
            stableJson(event)
          ].join(':')
        )
        .digest('hex');

      return {
        externalEventKey: messageId
          ? `meta:message:${messageId}`
          : `meta:event:${fallback}`,
        metaPageId: entry.id,
        eventTimestamp: event.timestamp,
        rawPayload: { pageId: entry.id, event }
      };
    })
  );
}

export function normalizeInboundTextMessage(
  rawPayload: unknown
): InboundTextMessage | null {
  if (rawPayload === null || typeof rawPayload !== 'object') {
    return null;
  }

  const envelope = rawPayload as {
    pageId?: unknown;
    event?: {
      sender?: { id?: unknown };
      timestamp?: unknown;
      message?: { mid?: unknown; text?: unknown; is_echo?: unknown };
    };
  };
  const event = envelope.event;

  if (
    typeof envelope.pageId !== 'string' ||
    typeof event?.sender?.id !== 'string' ||
    typeof event.timestamp !== 'number' ||
    typeof event.message?.mid !== 'string' ||
    typeof event.message.text !== 'string' ||
    event.message.is_echo === true
  ) {
    return null;
  }

  return {
    metaPageId: envelope.pageId,
    metaPsid: event.sender.id,
    metaMessageId: event.message.mid,
    text: event.message.text,
    timestamp: event.timestamp,
    payload: rawPayload
  };
}
