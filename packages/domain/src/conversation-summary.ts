import { z } from 'zod';
import { redactConversationText, type AgentContext } from './agent-context.js';
const safeText = z
  .string()
  .max(300)
  .refine(
    (value) =>
      redactConversationText(value) === value &&
      !/\d|\b(?:price|stock|quantity|order|phone|address|email)\b|giá|tồn kho|số lượng|đơn hàng|địa chỉ/iu.test(
        value
      ),
    'Summary must exclude private and transactional facts'
  );
export const ConversationSummarySchema = z
  .object({
    goal: safeText,
    constraints: z.array(safeText).max(5),
    preferences: z.array(safeText).max(5),
    discussedProductIds: z.array(z.uuid()).max(10),
    unresolvedQuestions: z.array(safeText).max(5)
  })
  .strict()
  .refine((value) => JSON.stringify(value).length <= 2000);
export function shouldRefreshSummary(
  lastSummaryAt: number | null,
  messagesSinceSummary: number,
  now: number
): boolean {
  return (
    messagesSinceSummary >= 12 ||
    (lastSummaryAt !== null && now - lastSummaryAt >= 86400000)
  );
}
/** Deterministic safe roll-up: no provider sees or invents private/transactional memory. */
export function createSafeConversationSummary(context: AgentContext) {
  return ConversationSummarySchema.parse({
    goal: 'Hỗ trợ khách hàng lựa chọn sản phẩm phù hợp.',
    constraints: [],
    preferences: [],
    discussedProductIds: [
      ...new Set(context.productReferences.map((ref) => ref.productId))
    ].slice(0, 10),
    unresolvedQuestions: []
  });
}
