import { z } from 'zod';

const AddressSchema = z
  .object({
    line1: z.string().trim().min(1).max(200),
    ward: z.string().trim().min(1).max(100),
    city: z.string().trim().min(1).max(100)
  })
  .strict();

export const CheckoutDraftSchema = z
  .object({
    conversationId: z.uuid(),
    version: z.number().int().positive(),
    state: z.enum([
      'none',
      'collecting_name',
      'collecting_phone',
      'collecting_address',
      'collecting_payment',
      'awaiting_confirmation'
    ]),
    recipientName: z.string().trim().min(1).max(120).nullable(),
    phone: z.string().trim().min(6).max(32).nullable(),
    address: AddressSchema.nullable(),
    paymentMethod: z.enum(['cod', 'bank_transfer', 'other']).nullable()
  })
  .strict();

export type CheckoutDraft = z.infer<typeof CheckoutDraftSchema>;
export interface CheckoutDraftRepository {
  get(conversationId: string): Promise<CheckoutDraft | null>;
  update(input: {
    conversationId: string;
    expectedVersion: number;
    state: CheckoutDraft['state'];
    recipientName?: string;
    phone?: string;
    address?: z.infer<typeof AddressSchema>;
    paymentMethod?: 'cod' | 'bank_transfer' | 'other';
  }): Promise<CheckoutDraft>;
}

function expected(draft: CheckoutDraft, state: CheckoutDraft['state']): void {
  if (draft.state !== state)
    throw new Error(`Expected checkout state: ${state}`);
}

export function createCheckoutFlow(repository: CheckoutDraftRepository) {
  return {
    async start(conversationId: string): Promise<CheckoutDraft> {
      const draft = await repository.get(conversationId);
      if (!draft) throw new Error('Checkout conversation was not found');
      if (draft.state !== 'none') return draft;
      return repository.update({
        conversationId,
        expectedVersion: draft.version,
        state: 'collecting_name'
      });
    },
    async setRecipientName(input: unknown): Promise<CheckoutDraft> {
      const value = z
        .object({
          conversationId: z.uuid(),
          expectedVersion: z.number().int().positive(),
          recipientName: z.string().trim().min(1).max(120)
        })
        .strict()
        .parse(input);
      const draft = await repository.get(value.conversationId);
      if (!draft) throw new Error('Checkout conversation was not found');
      expected(draft, 'collecting_name');
      return repository.update({ ...value, state: 'collecting_phone' });
    },
    async setPhone(input: unknown): Promise<CheckoutDraft> {
      const value = z
        .object({
          conversationId: z.uuid(),
          expectedVersion: z.number().int().positive(),
          phone: z.string().trim().min(6).max(32)
        })
        .strict()
        .parse(input);
      const draft = await repository.get(value.conversationId);
      if (!draft) throw new Error('Checkout conversation was not found');
      expected(draft, 'collecting_phone');
      return repository.update({ ...value, state: 'collecting_address' });
    },
    async setAddress(input: unknown): Promise<CheckoutDraft> {
      const value = z
        .object({
          conversationId: z.uuid(),
          expectedVersion: z.number().int().positive(),
          address: AddressSchema
        })
        .strict()
        .parse(input);
      const draft = await repository.get(value.conversationId);
      if (!draft) throw new Error('Checkout conversation was not found');
      expected(draft, 'collecting_address');
      return repository.update({ ...value, state: 'collecting_payment' });
    },
    async setPaymentMethod(input: unknown): Promise<CheckoutDraft> {
      const value = z
        .object({
          conversationId: z.uuid(),
          expectedVersion: z.number().int().positive(),
          paymentMethod: z.enum(['cod', 'bank_transfer', 'other'])
        })
        .strict()
        .parse(input);
      const draft = await repository.get(value.conversationId);
      if (!draft) throw new Error('Checkout conversation was not found');
      expected(draft, 'collecting_payment');
      return repository.update({ ...value, state: 'awaiting_confirmation' });
    }
  };
}
