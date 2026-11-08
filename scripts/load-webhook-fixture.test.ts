import { expect, it } from 'vitest';
import {
  createLoadPayload,
  validateLoadTarget,
  requireAcceptedResponse
} from './load-fixture.js';

it('uses separate sender and message identities for every load run', () => {
  const first = createLoadPayload('run-one', 0, 1234);
  const second = createLoadPayload('run-two', 0, 1234);
  expect(first.entry[0]?.messaging[0]?.message.mid).not.toBe(
    second.entry[0]?.messaging[0]?.message.mid
  );
  expect(first.entry[0]?.messaging[0]?.sender.id).not.toBe(
    second.entry[0]?.messaging[0]?.sender.id
  );
  expect(first.entry[0]?.messaging[0]?.timestamp).toBe(1234);
});
it('rejects production databases and remote URLs without explicit labeling', () => {
  expect(() =>
    validateLoadTarget(
      'http://127.0.0.1:3001',
      'postgres://localhost/fanpage_sales_agent_test'
    )
  ).not.toThrow();
  expect(() =>
    validateLoadTarget(
      'http://127.0.0.1:3001',
      'postgres://localhost/fanpage_sales_agent'
    )
  ).toThrow('isolated');
  expect(() =>
    validateLoadTarget(
      'https://demo.example.com',
      'postgres://localhost/fanpage_sales_agent_test'
    )
  ).toThrow('remote');
  expect(() =>
    validateLoadTarget(
      'https://demo.example.com',
      'postgres://localhost/fanpage_sales_agent_test',
      { allowRemote: true, label: 'release-demo' }
    )
  ).not.toThrow();
});
it('requires exactly one accepted request and valid JSON', async () => {
  await expect(
    requireAcceptedResponse(new Response('{"accepted":1}'))
  ).resolves.toBeUndefined();
  for (const response of [
    new Response('{"accepted":0}'),
    new Response('bad'),
    new Response('{"accepted":1}', { status: 500 })
  ]) {
    await expect(requireAcceptedResponse(response)).rejects.toThrow();
  }
});
