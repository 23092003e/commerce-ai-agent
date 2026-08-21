import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const config = {
  metaAppSecret: 'test-app-secret',
  metaVerifyToken: 'test-verify-token'
};

const apps: Array<ReturnType<typeof buildApp>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('Meta webhook HTTP contract', () => {
  it('returns the challenge for a valid verification request', async () => {
    const app = buildApp({ config });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/webhooks/meta?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=challenge-123'
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('challenge-123');
  });

  it('rejects an invalid verify token', async () => {
    const app = buildApp({ config });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-123'
    });

    expect(response.statusCode).toBe(403);
  });

  it('accepts a payload with a valid signature', async () => {
    const app = buildApp({ config });
    apps.push(app);
    const payload = JSON.stringify({ object: 'page', entry: [] });
    const signature = createHmac('sha256', config.metaAppSecret)
      .update(payload)
      .digest('hex');

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/meta',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${signature}`
      },
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: 0 });
  });

  it('rejects an invalid signature before parsing JSON', async () => {
    const app = buildApp({ config });
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/meta',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=invalid'
      },
      payload: '{not-json'
    });

    expect(response.statusCode).toBe(401);
  });
});
