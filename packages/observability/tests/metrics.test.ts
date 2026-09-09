import { describe, expect, it } from 'vitest';
import { createOperationalMetrics } from '../src/index.js';

describe('operational metrics', () => {
  it('emits an allowlisted metric while dropping PII-like labels', () => {
    const records: Array<{ bindings: unknown; message: string }> = [];
    const metrics = createOperationalMetrics({
      info(bindings, message) {
        records.push({ bindings, message });
      }
    });

    metrics.increment('meta_send_errors_total', {
      code: 'rate_limited',
      retryable: 'true',
      recipientId: 'customer-private-id',
      prompt: 'do not log this'
    });

    expect(records).toEqual([
      {
        bindings: {
          metric: 'meta_send_errors_total',
          value: 1,
          labels: { code: 'rate_limited', retryable: 'true' }
        },
        message: 'Operational metric'
      }
    ]);
  });

  it('rejects unknown metrics and non-finite observations', () => {
    const metrics = createOperationalMetrics({ info() {} });

    expect(() => metrics.increment('customer_message_text')).toThrow(
      'Unknown operational metric'
    );
    expect(() => metrics.observe('agent_latency_ms', Number.NaN)).toThrow(
      'Metric value must be finite'
    );
  });
});
