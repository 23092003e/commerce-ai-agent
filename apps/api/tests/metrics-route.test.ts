import { afterEach, expect, it } from 'vitest';
import { createOperationalMetrics } from '@fanpage/observability';
import { buildApp } from '../src/app.js';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
it('protects Prometheus output and disables caching', async () => {
  const metrics = createOperationalMetrics({ info() {} });
  metrics.increment('meta_sends_total', { status: 'sent' });
  const app = buildApp({
    config: { metaAppSecret: 'secret', metaVerifyToken: 'token' },
    metrics,
    metricsAuthSecret: 'metrics-secret-with-at-least-32-characters'
  });
  apps.push(app);
  expect((await app.inject('/internal/metrics')).statusCode).toBe(401);
  const response = await app.inject({
    url: '/internal/metrics',
    headers: {
      authorization: 'Bearer metrics-secret-with-at-least-32-characters'
    }
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toContain('text/plain');
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body).toContain('meta_sends_total');
});
