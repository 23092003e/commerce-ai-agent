import { describe, expect, it } from 'vitest';
import { isAuthorizedAdmin } from '../src/services/admin-auth.js';
describe('admin auth', () => {
  it('requires an exact bearer secret', () => {
    const secret = '01234567890123456789012345678901';
    expect(isAuthorizedAdmin(`Bearer ${secret}`, secret)).toBe(true);
    expect(isAuthorizedAdmin('Bearer incorrect', secret)).toBe(false);
    expect(isAuthorizedAdmin(undefined, secret)).toBe(false);
    expect(isAuthorizedAdmin(`Bearer ${secret}`, undefined)).toBe(false);
  });
});
