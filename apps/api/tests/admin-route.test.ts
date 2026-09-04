import { InMemoryCommerceRepository } from '@fanpage/db';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
const secret = '01234567890123456789012345678901';
const conversationId = '11111111-1111-4111-8111-111111111111';
describe('admin conversation control route', () => {
  it('requires auth before calling the control repository', async () => {
    const repository = new InMemoryCommerceRepository();
    const app = buildApp({
      config: {
        metaAppSecret: 'a'.repeat(16),
        metaVerifyToken: 'b'.repeat(16)
      },
      admin: { secret, repository }
    });
    const url = `/internal/admin/conversations/${conversationId}/control`;
    const denied = await app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ expectedVersion: 1, controlMode: 'human' })
    });
    expect(denied.statusCode).toBe(401);
    const missing = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json'
      },
      payload: JSON.stringify({ expectedVersion: 1, controlMode: 'human' })
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});
