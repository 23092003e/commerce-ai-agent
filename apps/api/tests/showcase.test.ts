import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('portfolio showcase', () => {
  it('serves a public introduction with honest demo limitations', async () => {
    const app = buildApp({
      config: { metaAppSecret: 'test-secret', metaVerifyToken: 'test-token' }
    });
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('Monexis');
    expect(response.body).toContain('github.com/23092003e/commerce-ai-agent');
    expect(response.body).toContain('không giao hàng');
    await app.close();
  });
});
