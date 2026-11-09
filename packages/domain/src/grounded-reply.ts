import { z } from 'zod';
import type { AgentToolTrace } from './agent-orchestrator.js';
const uuid = z.uuid();
export const AgentReplyDecisionSchema = z
  .object({
    type: z.literal('reply'),
    intro: z.string().trim().max(300).optional(),
    facts: z
      .array(
        z.discriminatedUnion('type', [
          z
            .object({ type: z.literal('catalog_product'), productId: uuid })
            .strict(),
          z
            .object({ type: z.literal('catalog_variant'), variantId: uuid })
            .strict(),
          z.object({ type: z.literal('inventory'), variantId: uuid }).strict(),
          z.object({ type: z.literal('cart'), cartId: uuid }).strict(),
          z
            .object({
              type: z.literal('checkout_confirmation'),
              confirmationId: z.string().min(1).max(200)
            })
            .strict(),
          z.object({ type: z.literal('order'), orderId: uuid }).strict(),
          z
            .object({
              type: z.literal('knowledge'),
              chunkIds: z.array(uuid).min(1).max(10)
            })
            .strict()
        ])
      )
      .max(10),
    nextQuestion: z.string().trim().max(300).optional()
  })
  .strict();
export type AgentReplyDecision = z.infer<typeof AgentReplyDecisionSchema>;
export const SAFE_REPLY_INTROS = [
  'Dạ em gửi anh/chị thông tin đã kiểm tra.',
  'Dạ em chào anh/chị.',
  'Dạ em hiểu rồi ạ.',
  'Em đã kiểm tra thông tin cho anh/chị.',
  'Here is the verified information.',
  'Hello, how can I help?'
] as const;
export const SAFE_REPLY_QUESTIONS = [
  'Anh/chị đang tìm bánh cho dịp nào ạ?',
  'Anh/chị cần bánh cho khoảng bao nhiêu người ạ?',
  'Anh/chị quan tâm mẫu nào ạ?',
  'Anh/chị muốn em hỗ trợ thêm điều gì ạ?',
  'Anh/chị thích vị bánh hoặc kích thước nào ạ?',
  'Anh/chị muốn chọn mẫu này không ạ?',
  'Anh/chị cho em xin tên người nhận ạ?',
  'Anh/chị cho em xin số điện thoại nhận hàng ạ?',
  'Anh/chị cho em xin địa chỉ nhận hàng ạ?',
  'Anh/chị muốn thanh toán bằng cách nào ạ?',
  'Anh/chị xác nhận thông tin đặt hàng giúp em nhé?',
  'Could you tell me which option you prefer?'
] as const;
export class GroundingError extends Error {
  constructor(
    readonly code:
      | 'invalid_decision'
      | 'unsafe_intro'
      | 'unsafe_question'
      | 'missing_evidence'
      | 'invalid_output'
  ) {
    super('grounding_failed');
  }
}
export function validateAndRenderGroundedReply(input: {
  decision: unknown;
  ledger: AgentToolTrace[];
  locale: string;
}): { text: string; evidenceChunkIds: string[] } {
  const parsed = AgentReplyDecisionSchema.safeParse(input.decision);
  function fail(code: GroundingError['code'] = 'missing_evidence'): never {
    throw new GroundingError(code);
  }
  if (!parsed.success) return fail('invalid_decision');
  const decision = parsed.data;
  if (
    decision.intro &&
    !SAFE_REPLY_INTROS.some((text) => text === decision.intro)
  )
    fail('unsafe_intro');
  if (
    decision.nextQuestion &&
    !SAFE_REPLY_QUESTIONS.some((text) => text === decision.nextQuestion)
  )
    fail('unsafe_question');
  const evidence = input.ledger
    .filter((item) => item.status === 'succeeded')
    .flatMap((item) => item.evidence ?? []);
  if (
    input.ledger.some((item) => item.name === 'knowledge.search') &&
    !evidence.some((item) => item.type === 'knowledge') &&
    !decision.nextQuestion
  )
    fail();
  const sentences: string[] = decision.intro ? [decision.intro] : [];
  const chunks: string[] = [];
  const money = (amount: number, currency: string) =>
    new Intl.NumberFormat(input.locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0
    }).format(amount);
  for (const fact of decision.facts) {
    if (fact.type === 'knowledge') {
      for (const id of fact.chunkIds) {
        const found = evidence.find(
          (item) => item.type === 'knowledge' && item.value.chunkId === id
        );
        if (found?.type !== 'knowledge') fail();
        sentences.push(found.value.content);
        chunks.push(id);
      }
      continue;
    }
    if (fact.type === 'catalog_product') {
      const found = evidence.find(
        (item) =>
          item.type === 'catalog_product' &&
          item.value.productId === fact.productId
      );
      if (found?.type !== 'catalog_product') fail();
      sentences.push(
        `${found.value.name}: từ ${money(found.value.priceFrom, found.value.currency)}.`
      );
    }
    if (fact.type === 'catalog_variant') {
      const found = evidence.find(
        (item) =>
          item.type === 'catalog_variant' &&
          item.value.variantId === fact.variantId
      );
      if (found?.type !== 'catalog_variant') fail();
      sentences.push(
        `${found.value.title} (${found.value.sku}): ${money(found.value.price, found.value.currency)}.`
      );
    }
    if (fact.type === 'inventory') {
      const found = evidence.find(
        (item) =>
          item.type === 'inventory' && item.value.variantId === fact.variantId
      );
      if (found?.type !== 'inventory') fail();
      sentences.push(
        `Tồn kho hiện có: ${String(found.value.availableQuantity)} sản phẩm.`
      );
    }
    if (fact.type === 'cart') {
      const found = evidence.find(
        (item) => item.type === 'cart' && item.value.id === fact.cartId
      );
      if (found?.type !== 'cart') fail();
      sentences.push(
        ...found.value.lines.map(
          (line) =>
            `${line.title} × ${String(line.quantity)}: ${money(line.lineTotal, found.value.currency)}.`
        ),
        `Tổng giỏ hàng: ${money(found.value.total, found.value.currency)}.`
      );
    }
    if (fact.type === 'checkout_confirmation') {
      const found = evidence.find(
        (item) =>
          item.type === 'checkout_confirmation' &&
          item.value.confirmationId === fact.confirmationId
      );
      if (found?.type !== 'checkout_confirmation') fail();
      sentences.push(
        `Thông tin đặt hàng đã sẵn sàng để anh/chị xác nhận. Tổng thanh toán: ${money(found.value.total, found.value.currency)}.`
      );
    }
    if (fact.type === 'order') {
      const found = evidence.find(
        (item) => item.type === 'order' && item.value.orderId === fact.orderId
      );
      if (found?.type !== 'order') fail();
      sentences.push(`Đơn hàng ${found.value.orderNumber} đã được tạo.`);
    }
  }
  if (decision.nextQuestion) sentences.push(decision.nextQuestion);
  const text = sentences.join('\n');
  if (!text || text.length > 10000) fail('invalid_output');
  return { text, evidenceChunkIds: [...new Set(chunks)] };
}
