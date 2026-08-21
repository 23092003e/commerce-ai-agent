import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';

export function verifyMetaSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!signatureHeader?.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  const suppliedHex = signatureHeader.slice(SIGNATURE_PREFIX.length);
  if (!/^[a-f\d]{64}$/iu.test(suppliedHex)) {
    return false;
  }

  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const supplied = Buffer.from(suppliedHex, 'hex');

  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
