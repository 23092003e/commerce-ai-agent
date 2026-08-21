import { FakeMessagingChannel } from '@fanpage/meta';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const apps: Array<ReturnType<typeof buildApp>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('fake Meta outbound test surface', () => {
  it('sends and exposes captured text when explicitly enabled', async () => {
    const messagingChannel = new FakeMessagingChannel();
    const app = buildApp({
      config: { metaAppSecret: 'secret', metaVerifyToken: 'token' },
      messagingChannel,
      enableTestMessagingRoutes: true
    });
    apps.push(app);

    const sendResponse = await app.inject({
      method: 'POST',
      url: '/internal/test/meta/outbound',
      payload: { recipientId: 'customer-1', text: 'Xin chào' }
    });
    const capturedResponse = await app.inject({
      method: 'GET',
      url: '/internal/test/meta/outbound'
    });

    expect(sendResponse.statusCode).toBe(200);
    expect(capturedResponse.json()).toMatchObject({
      messages: [{ recipientId: 'customer-1', text: 'Xin chào' }]
    });
  });

  it('does not expose the test surface unless explicitly enabled', async () => {
    const app = buildApp({
      config: { metaAppSecret: 'secret', metaVerifyToken: 'token' },
      messagingChannel: new FakeMessagingChannel()
    });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/internal/test/meta/outbound'
    });

    expect(response.statusCode).toBe(404);
  });
});
