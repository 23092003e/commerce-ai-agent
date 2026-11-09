export class DecisionProviderError extends Error {
  constructor(
    readonly code: `http_${string}` | 'timeout' | 'network' | 'invalid_response'
  ) {
    super('decision_provider_failed');
  }
}
