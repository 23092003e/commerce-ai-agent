import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyMetaSignature } from '../src/index.js';

describe('Meta webhook signature verification', () => {
  const secret = 'test-app-secret';
  const body = Buffer.from('{"object":"page","entry":[]}');

  it('accepts the valid HMAC signature for the exact raw body', () => {
    const digest = createHmac('sha256', secret).update(body).digest('hex');

    expect(verifyMetaSignature(body, `sha256=${digest}`, secret)).toBe(true);
  });

  it('rejects an invalid signature without throwing', () => {
    expect(verifyMetaSignature(body, 'sha256=invalid', secret)).toBe(false);
  });
});
