import {
  SAFE_REPLY_INTROS,
  SAFE_REPLY_QUESTIONS,
  type StructuredDecisionProvider
} from '@fanpage/domain';

export function createFakeDecisionProvider(
  adapter: 'fake' | 'graph'
): StructuredDecisionProvider {
  return {
    async decide() {
      return adapter === 'fake'
        ? {
            type: 'reply',
            intro: SAFE_REPLY_INTROS[1],
            facts: [],
            nextQuestion: SAFE_REPLY_QUESTIONS[1]
          }
        : { type: 'handover', reason: 'ai_provider_not_configured' };
    }
  };
}
