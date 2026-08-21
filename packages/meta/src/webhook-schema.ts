import { z } from 'zod';

const MetaMessageSchema = z
  .object({
    mid: z.string().min(1),
    text: z.string().optional(),
    is_echo: z.boolean().optional()
  })
  .loose();

const MetaMessagingEventSchema = z
  .object({
    sender: z.object({ id: z.string().min(1) }),
    recipient: z.object({ id: z.string().min(1) }),
    timestamp: z.number().int().nonnegative(),
    message: MetaMessageSchema.optional()
  })
  .loose();

const MetaEntrySchema = z
  .object({
    id: z.string().min(1),
    time: z.number().int().nonnegative(),
    messaging: z.array(MetaMessagingEventSchema).default([])
  })
  .loose();

export const MetaWebhookPayloadSchema = z
  .object({
    object: z.literal('page'),
    entry: z.array(MetaEntrySchema)
  })
  .strict();

export type MetaWebhookPayload = z.infer<typeof MetaWebhookPayloadSchema>;
