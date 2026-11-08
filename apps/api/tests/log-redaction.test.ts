import pino from 'pino';
import { InMemoryCommerceRepository } from '@fanpage/db';
import { expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

it('does not log request query secrets or raw dependency error messages', async () => {
  const records: string[] = [];
  const logger = pino(
    {},
    {
      write: (line: string) => {
        records.push(line);
      }
    }
  );
  const secret = 'a'.repeat(32);
  const app = buildApp({
    logger,
    config: { metaAppSecret: secret, metaVerifyToken: secret },
    admin: {
      secret,
      session: { legacyBearerEnabled: true },
      repository: new InMemoryCommerceRepository(),
      data: {
        listConversations: async () => {
          throw new Error('dependency contains PRIVATE_CUSTOMER_DATA');
        }
      }
    }
  });
  try {
    const response = await app.inject({
      url: '/internal/admin/conversations?secret=PRIVATE_URL_TOKEN',
      headers: { authorization: `Bearer ${secret}` }
    });
    expect(response.statusCode).toBe(500);
    expect(records.join('')).not.toContain('PRIVATE_CUSTOMER_DATA');
    expect(records.join('')).not.toContain('PRIVATE_URL_TOKEN');
    expect(records.join('')).not.toContain(secret);
  } finally {
    await app.close();
  }
});
