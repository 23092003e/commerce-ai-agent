import { createAgentOrchestrator } from '@fanpage/domain';
import { expect, it } from 'vitest';
import { createFakeDecisionProvider } from '../src/services/fake-decision.js';

it('returns a safe greeting in the fake channel and hands over for a real channel', async () => {
  const context = {
    customerMessage: 'hi',
    controlMode: 'ai',
    recentMessages: [],
    cart: null,
    checkout: null,
    productReferences: []
  };
  const fake = createAgentOrchestrator({
    provider: createFakeDecisionProvider('fake'),
    tools: []
  });
  const graph = createAgentOrchestrator({
    provider: createFakeDecisionProvider('graph'),
    tools: []
  });
  expect(await fake.run(context)).toMatchObject({ type: 'reply' });
  expect(await graph.run(context)).toMatchObject({ type: 'handover' });
});
