import { InMemoryCommerceRepository } from '@fanpage/db';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
const secret = 'a'.repeat(32);
function setup(production = false) {
  let time = 1_000_000;
  const app = buildApp({
    config: { metaAppSecret: secret, metaVerifyToken: secret },
    admin: {
      secret,
      repository: new InMemoryCommerceRepository(),
      session: { production, now: () => time }
    }
  });
  return {
    app,
    expire: () => {
      time += 8 * 60 * 60_000;
    }
  };
}
async function login(app: ReturnType<typeof buildApp>) {
  const response = await app.inject({
    method: 'POST',
    url: '/internal/admin/session',
    payload: { secret }
  });
  expect(response.statusCode).toBe(200);
  return {
    cookie: String(response.headers['set-cookie']).split(';')[0] ?? '',
    csrf: response.json<{ csrfToken: string }>().csrfToken,
    response
  };
}
describe('Admin signed sessions', () => {
  it('uses secure HttpOnly strict cookies and rejects bearer in production', async () => {
    const { app } = setup(true);
    const { response, cookie } = await login(app);
    expect(response.headers['set-cookie']).toContain(
      'HttpOnly; SameSite=Strict'
    );
    expect(response.headers['set-cookie']).toContain('Secure');
    expect(response.body).not.toContain(secret);
    expect(
      (
        await app.inject({
          url: '/internal/admin/session',
          headers: { cookie }
        })
      ).statusCode
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: '/internal/admin/conversations',
          headers: { authorization: `Bearer ${secret}` }
        })
      ).statusCode
    ).toBe(401);
    await app.close();
  });
  it('rejects tampering, expiration, bad secrets and unknown login keys', async () => {
    const { app, expire } = setup();
    const { cookie } = await login(app);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/internal/admin/session',
          payload: { secret: 'wrong' }
        })
      ).statusCode
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/internal/admin/session',
          payload: { secret, extra: true }
        })
      ).statusCode
    ).toBe(400);
    expect(
      (
        await app.inject({
          url: '/internal/admin/session',
          headers: { cookie: cookie + 'x' }
        })
      ).statusCode
    ).toBe(401);
    expire();
    expect(
      (
        await app.inject({
          url: '/internal/admin/session',
          headers: { cookie }
        })
      ).statusCode
    ).toBe(401);
    await app.close();
  });
  it('protects mutations with CSRF and origin policy and clears the cookie on logout', async () => {
    const { app } = setup();
    const { cookie, csrf } = await login(app);
    for (const headers of [
      { cookie },
      { cookie, 'x-csrf-token': 'wrong' },
      { cookie, 'x-csrf-token': csrf, origin: 'https://evil.example' }
    ]) {
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: '/internal/admin/session',
            headers
          })
        ).statusCode
      ).toBe(403);
    }
    const out = await app.inject({
      method: 'DELETE',
      url: '/internal/admin/session',
      headers: { cookie, 'x-csrf-token': csrf }
    });
    expect(
      (
        await app.inject({
          url: '/internal/admin/session',
          headers: { cookie }
        })
      ).statusCode
    ).toBe(401);
    expect(out.statusCode).toBe(204);
    expect(out.headers['set-cookie']).toContain('Max-Age=0');
    await app.close();
  });
  it('limits login six, read 121, mutation 31 and resets after the window', async () => {
    const { app, expire } = setup();
    const { cookie, csrf } = await login(app);
    for (let i = 1; i < 5; i++)
      await app.inject({
        method: 'POST',
        url: '/internal/admin/session',
        payload: { secret: 'wrong' }
      });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/internal/admin/session',
          payload: { secret }
        })
      ).statusCode
    ).toBe(429);
    for (let i = 0; i < 120; i++)
      expect(
        (
          await app.inject({
            url: '/internal/admin/session',
            headers: { cookie }
          })
        ).statusCode
      ).toBe(200);
    expect(
      (
        await app.inject({
          url: '/internal/admin/session',
          headers: { cookie }
        })
      ).statusCode
    ).toBe(429);
    for (let i = 0; i < 30; i++)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/internal/admin/conversations/invalid/control',
            headers: { cookie, 'x-csrf-token': csrf },
            payload: {}
          })
        ).statusCode
      ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/internal/admin/conversations/invalid/control',
          headers: { cookie, 'x-csrf-token': csrf },
          payload: {}
        })
      ).statusCode
    ).toBe(429);
    expire();
    await login(app);
    await app.close();
  });
});
