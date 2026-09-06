import {
  createCheckoutFlow,
  type CheckoutDraft,
  type CheckoutDraftRepository
} from '../src/index.js';
import { describe, expect, it } from 'vitest';

const conversationId = '11111111-1111-4111-8111-111111111111';

function createRepository(): CheckoutDraftRepository {
  let draft: CheckoutDraft = {
    conversationId,
    version: 1,
    state: 'none',
    recipientName: null,
    phone: null,
    address: null,
    paymentMethod: null
  };
  return {
    async get(id) {
      return id === conversationId ? structuredClone(draft) : null;
    },
    async update(input) {
      if (input.expectedVersion !== draft.version)
        throw new Error('Checkout version conflict');
      draft = {
        ...draft,
        ...input,
        version: draft.version + 1,
        recipientName: input.recipientName ?? draft.recipientName,
        phone: input.phone ?? draft.phone,
        address: input.address ?? draft.address,
        paymentMethod: input.paymentMethod ?? draft.paymentMethod
      };
      return structuredClone(draft);
    }
  };
}

describe('checkout flow', () => {
  it('collects checkout fields in deterministic order', async () => {
    const flow = createCheckoutFlow(createRepository());
    const started = await flow.start(conversationId);
    const name = await flow.setRecipientName({
      conversationId,
      expectedVersion: started.version,
      recipientName: 'Lan'
    });
    const phone = await flow.setPhone({
      conversationId,
      expectedVersion: name.version,
      phone: '0900000000'
    });
    const address = await flow.setAddress({
      conversationId,
      expectedVersion: phone.version,
      address: { line1: '1 Main', ward: 'Ward 1', city: 'HCM' }
    });
    const complete = await flow.setPaymentMethod({
      conversationId,
      expectedVersion: address.version,
      paymentMethod: 'cod'
    });

    expect(complete).toMatchObject({
      state: 'awaiting_confirmation',
      recipientName: 'Lan',
      phone: '0900000000',
      paymentMethod: 'cod'
    });
  });

  it('rejects out-of-order checkout fields', async () => {
    const flow = createCheckoutFlow(createRepository());

    await expect(
      flow.setPhone({
        conversationId,
        expectedVersion: 1,
        phone: '0900000000'
      })
    ).rejects.toThrow('Expected checkout state: collecting_phone');
  });
});
