export type DomainErrorCode =
  | 'not_found'
  | 'version_conflict'
  | 'invalid_transition'
  | 'ownership_mismatch'
  | 'inventory_unavailable'
  | 'confirmation_missing'
  | 'confirmation_stale'
  | 'confirmation_expired'
  | 'confirmation_consumed'
  | 'grounding_failed'
  | 'delivery_failed'
  | 'delivery_unknown';
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string = code,
    readonly retryable = false
  ) {
    super(message);
  }
}
export function domainErrorHttpStatus(code: DomainErrorCode): number {
  if (code === 'not_found') return 404;
  if (
    [
      'version_conflict',
      'confirmation_missing',
      'confirmation_stale',
      'confirmation_expired',
      'confirmation_consumed'
    ].includes(code)
  )
    return 409;
  if (
    [
      'invalid_transition',
      'ownership_mismatch',
      'inventory_unavailable'
    ].includes(code)
  )
    return 422;
  return 500;
}
