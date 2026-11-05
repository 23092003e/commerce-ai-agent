import { z } from 'zod';

const phonePattern = /\+?\d[\d ().-]{6,}\d/gu;
const emailPattern = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu;
const addressPattern =
  /(?:địa chỉ|dia chi|address|đường|duong|street|road|lane|ward|phường|quận)(?=\s|[:,]|$)/iu;
export function redactConversationText(
  text: string,
  privateValues: string[] = []
): string {
  let safe = text;
  for (const value of privateValues)
    if (value.trim().length >= 3) safe = safe.split(value).join('[redacted]');
  if (addressPattern.test(safe)) return '[redacted contact details]';
  return safe
    .replace(phonePattern, '[redacted phone]')
    .replace(emailPattern, '[redacted email]');
}
const RecentMessageSchema = z
  .object({
    direction: z.enum(['inbound', 'outbound']),
    senderType: z.enum(['customer', 'ai', 'human', 'system']),
    text: z
      .string()
      .max(4000)
      .refine(
        (text) => redactConversationText(text) === text,
        'Private history is forbidden'
      ),
    createdAt: z.iso.datetime()
  })
  .strict();
export type RecentAgentMessage = z.infer<typeof RecentMessageSchema>;
export function boundRecentMessages(
  rows: RecentAgentMessage[]
): RecentAgentMessage[] {
  const result: RecentAgentMessage[] = [];
  let remaining = 4000;
  for (const row of rows.slice(-12).reverse()) {
    if (remaining <= 0) break;
    const text = redactConversationText(row.text).slice(-remaining);
    remaining -= text.length;
    result.unshift({ ...row, text });
  }
  return result;
}

const AgentContextSchema = z
  .object({
    customerMessage: z.string().trim().min(1).max(2_000),
    controlMode: z.enum(['ai', 'human', 'paused']).default('ai'),
    summary: z.string().trim().min(1).max(2_000).optional(),
    recentMessages: z
      .array(RecentMessageSchema)
      .max(12)
      .refine(
        (rows) => rows.reduce((sum, row) => sum + row.text.length, 0) <= 4000
      )
      .default([]),
    cart: z
      .object({
        id: z.uuid(),
        version: z.number().int().positive(),
        currency: z.string().regex(/^[A-Z]{3}$/u),
        lines: z
          .array(
            z
              .object({
                variantId: z.uuid(),
                title: z.string().max(200),
                quantity: z.number().int().min(1).max(99)
              })
              .strict()
          )
          .max(100)
      })
      .strict()
      .nullable()
      .default(null),
    checkout: z
      .object({
        version: z.number().int().positive(),
        state: z.enum([
          'none',
          'collecting_name',
          'collecting_phone',
          'collecting_address',
          'collecting_payment',
          'awaiting_confirmation'
        ]),
        missingFields: z
          .array(z.enum(['recipientName', 'phone', 'address', 'paymentMethod']))
          .max(4),
        preparedConfirmationId: z.string().max(200).optional()
      })
      .strict()
      .nullable()
      .default(null),
    productReferences: z
      .array(
        z
          .object({
            position: z.number().int().positive().max(10),
            productId: z.uuid(),
            variantId: z.uuid().nullable().optional()
          })
          .strict()
      )
      .max(10)
      .default([])
  })
  .strict();

export type AgentContext = z.infer<typeof AgentContextSchema>;
export interface ConversationContextRepository {
  load(input: {
    conversationId: string;
    recentMessageLimit: 12;
    recentCharacterBudget: 4000;
    excludeMessageId?: string;
  }): Promise<Omit<AgentContext, 'customerMessage'>>;
}

export function assembleAgentContext(input: unknown): AgentContext {
  return AgentContextSchema.parse(input);
}
