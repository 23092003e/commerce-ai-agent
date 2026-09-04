import { z } from 'zod';

const AgentContextSchema = z
  .object({
    customerMessage: z.string().trim().min(1).max(2_000),
    summary: z.string().trim().min(1).max(2_000).optional(),
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

export function assembleAgentContext(input: unknown): AgentContext {
  return AgentContextSchema.parse(input);
}
