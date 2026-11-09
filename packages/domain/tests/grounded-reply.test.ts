import { describe, expect, it } from 'vitest';
import { validateAndRenderGroundedReply } from '../src/grounded-reply.js';
import { projectToolEvidence } from '../src/tool-evidence.js';
const productId = '11111111-1111-4111-8111-111111111111';
const variantId = '22222222-2222-4222-8222-222222222222';
const chunkId = '33333333-3333-4333-8333-333333333333';
describe('grounded replies', () => {
  it('classifies an unsafe introduction without including model text in the diagnostic', () => {
    try {
      validateAndRenderGroundedReply({
        decision: { type: 'reply', intro: 'private invented text', facts: [] },
        ledger: [],
        locale: 'vi-VN'
      });
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toMatchObject({
        message: 'grounding_failed',
        code: 'unsafe_intro'
      });
      expect(JSON.stringify(error)).not.toContain('private invented text');
    }
  });
  it('renders authoritative prices and policy excerpts and retains safe references', () => {
    const ledger = [
      projectToolEvidence(
        'catalog.searchProducts',
        { query: 'private text' },
        {
          products: [
            { productId, name: 'Bánh kem', priceFrom: 120000, currency: 'VND' }
          ]
        },
        1
      ),
      projectToolEvidence(
        'knowledge.search',
        { query: 'policy' },
        {
          type: 'evidence',
          chunks: [
            { chunkId, documentId: productId, content: 'Giao trong hai ngày.' }
          ]
        },
        2
      )
    ];
    const result = validateAndRenderGroundedReply({
      decision: {
        type: 'reply',
        intro: 'Dạ em gửi anh/chị thông tin đã kiểm tra.',
        facts: [
          { type: 'catalog_product', productId },
          { type: 'knowledge', chunkIds: [chunkId] }
        ]
      },
      ledger,
      locale: 'vi-VN'
    });
    expect(result.text).toContain('Bánh kem');
    expect(result.text).toContain('120.000');
    expect(result.text).toContain('Giao trong hai ngày.');
    expect(result.evidenceChunkIds).toEqual([chunkId]);
    expect(JSON.stringify(ledger.map((x) => x.argumentSummary))).not.toContain(
      'private text'
    );
  });
  it.each([
    { type: 'catalog_product', productId },
    { type: 'catalog_variant', variantId },
    { type: 'inventory', variantId },
    { type: 'cart', cartId: productId },
    { type: 'checkout_confirmation', confirmationId: 'absent' },
    { type: 'order', orderId: productId },
    { type: 'knowledge', chunkIds: [chunkId] },
    { type: 'knowledge', chunkIds: [] }
  ])('rejects absent or empty fact evidence %j', (fact) => {
    expect(() =>
      validateAndRenderGroundedReply({
        decision: { type: 'reply', facts: [fact] },
        ledger: [],
        locale: 'vi-VN'
      })
    ).toThrow('grounding_failed');
  });
  it('rejects freeform transactional prose and archived or insufficient policy data', () => {
    expect(() =>
      validateAndRenderGroundedReply({
        decision: { type: 'reply', intro: 'Giá chỉ 1 đồng', facts: [] },
        ledger: [],
        locale: 'vi-VN'
      })
    ).toThrow('grounding_failed');
    for (const result of [
      { type: 'insufficient_evidence', chunks: [] },
      {
        type: 'evidence',
        chunks: [
          {
            chunkId,
            documentId: productId,
            content: 'Archived',
            status: 'archived'
          }
        ]
      }
    ]) {
      expect(() =>
        validateAndRenderGroundedReply({
          decision: {
            type: 'reply',
            facts: [{ type: 'knowledge', chunkIds: [chunkId] }]
          },
          ledger: [projectToolEvidence('knowledge.search', {}, result, 1)],
          locale: 'vi-VN'
        })
      ).toThrow('grounding_failed');
    }
  });
});
