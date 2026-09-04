import { timingSafeEqual } from 'node:crypto';

export function isAuthorizedAdmin(
  authorization: string | undefined,
  secret: string | undefined
): boolean {
  if (!secret || !authorization?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(authorization.slice('Bearer '.length));
  const expected = Buffer.from(secret);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}
