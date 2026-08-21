import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const apps: Array<ReturnType<typeof buildApp>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('service health', () => {
  it('reports liveness without checking dependencies', async () => {
    const app = buildApp({
      config: { metaAppSecret: 'secret', metaVerifyToken: 'token' }
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('reports not ready when a dependency check fails', async () => {
    const app = buildApp({
      config: { metaAppSecret: 'secret', metaVerifyToken: 'token' },
      readiness: {
        async check() {
          throw new Error('database unavailable');
        }
      }
    });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready' });
  });
});
