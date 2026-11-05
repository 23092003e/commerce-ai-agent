export interface ConversationLeaseContext {
  readonly conversationKey: string;
  readonly token: symbol;
}
export interface ControlConversationView {
  id: string;
  pageId: string;
  customerId: string;
  status: 'open' | 'closed';
  controlMode: 'ai' | 'human' | 'paused';
  version: number;
}
export type ConversationControlResult =
  | { type: 'updated'; conversation: ControlConversationView }
  | { type: 'conflict'; currentVersion: number }
  | { type: 'not_found' }
  | { type: 'invalid_transition' };
export interface AdminControlInput {
  conversationId: string;
  expectedVersion: number;
  adminActor: string;
}
export interface ConversationControlService {
  requestHandover(
    input: {
      conversationId: string;
      reasonCode: string;
      reasonText?: string;
      source: 'agent' | 'delivery' | 'admin';
    },
    lease?: ConversationLeaseContext
  ): Promise<ConversationControlResult>;
  takeOver(
    input: AdminControlInput,
    lease?: ConversationLeaseContext
  ): Promise<ConversationControlResult>;
  resolveToAi(
    input: AdminControlInput,
    lease?: ConversationLeaseContext
  ): Promise<ConversationControlResult>;
  pause(
    input: AdminControlInput,
    lease?: ConversationLeaseContext
  ): Promise<ConversationControlResult>;
}
export function createConversationControlService(
  repository: ConversationControlService
): ConversationControlService {
  return repository;
}
