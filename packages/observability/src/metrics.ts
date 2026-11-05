import { Counter, Histogram, Gauge, Registry } from 'prom-client';

const metricNames = new Set([
  'webhook_validation_failures_total',
  'webhook_events_total',
  'worker_duration_ms',
  'agent_latency_ms',
  'llm_errors_total',
  'tool_errors_total',
  'meta_send_errors_total',
  'meta_sends_total',
  'handovers_total',
  'rag_no_evidence_total',
  'checkout_starts_total',
  'checkout_completions_total',
  'orders_total',
  'llm_tokens',
  'tool_duration_ms',
  'queue_jobs',
  'llm_calls_total',
  'llm_duration_ms',
  'tool_calls_total',
  'rag_searches_total'
]);

const labelKeys = new Set([
  'code',
  'outcome',
  'reason',
  'retryable',
  'status',
  'toolName'
]);

export type OperationalMetricName =
  | 'webhook_validation_failures_total'
  | 'webhook_events_total'
  | 'worker_duration_ms'
  | 'agent_latency_ms'
  | 'llm_errors_total'
  | 'tool_errors_total'
  | 'meta_send_errors_total'
  | 'meta_sends_total'
  | 'handovers_total'
  | 'rag_no_evidence_total'
  | 'checkout_starts_total'
  | 'checkout_completions_total'
  | 'orders_total'
  | 'llm_tokens'
  | 'tool_duration_ms'
  | 'queue_jobs'
  | 'llm_calls_total'
  | 'llm_duration_ms'
  | 'tool_calls_total'
  | 'rag_searches_total';

export interface MetricLogger {
  info(bindings: Record<string, unknown>, message: string): void;
}

export interface OperationalMetrics {
  increment(name: string, labels?: Record<string, string>): void;
  observe(name: string, value: number, labels?: Record<string, string>): void;
  gauge?(name: string, value: number, labels?: Record<string, string>): void;
  text?(): Promise<string>;
  contentType?: string;
}

const allowedValues: Record<string, Set<string>> = {
  code: new Set([
    'rate_limited',
    'authentication',
    'invalid_request',
    'network_error',
    'timeout',
    'server_error',
    'provider_error',
    'invalid_signature',
    'invalid_payload',
    'invalid_json',
    'missing_signature',
    'unknown',
    'failed',
    'grounding_failed',
    'other'
  ]),
  outcome: new Set([
    'replied',
    'handed_over',
    'no_action',
    'failed',
    'evidence',
    'insufficient_evidence',
    'created',
    'replayed',
    'prepared',
    'stale',
    'consumed',
    'other'
  ]),
  reason: new Set([
    'customer_requested_human',
    'provider_error',
    'delivery_failed',
    'delivery_unknown',
    'grounding_failed',
    'insufficient_evidence',
    'staff_required',
    'other'
  ]),
  retryable: new Set(['true', 'false']),
  status: new Set([
    'created',
    'replayed',
    'prepared',
    'consumed',
    'confirmation_stale',
    'confirmation_expired',
    'success',
    'error',
    'evidence',
    'insufficient_evidence',
    'accepted',
    'duplicate',
    'rejected',
    'queued',
    'processing',
    'processed',
    'sent',
    'delivered',
    'sending',
    'unknown',
    'retryable',
    'failed',
    'completed',
    'active',
    'waiting',
    'delayed',
    'no_action',
    'input',
    'output',
    'other'
  ]),
  toolName: new Set([
    'knowledge.search',
    'catalog.searchProducts',
    'catalog.getProduct',
    'catalog.getVariant',
    'catalog.checkInventory',
    'cart.add',
    'cart.update',
    'cart.remove',
    'checkout.start',
    'checkout.setRecipientName',
    'checkout.setPhone',
    'checkout.setAddress',
    'checkout.setPaymentMethod',
    'checkout.prepareConfirmation',
    'checkout.getState',
    'other'
  ])
};

function sanitizeLabels(
  labels: Record<string, string> = {}
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(labels).flatMap(([key, value]) =>
      labelKeys.has(key)
        ? [[key, allowedValues[key]?.has(value) ? value : 'other']]
        : []
    )
  );
}

export function createOperationalMetrics(
  logger: MetricLogger
): OperationalMetrics & { text(): Promise<string>; contentType: string } {
  const registry = new Registry();
  const instruments = new Map<string, Counter | Histogram | Gauge>();
  for (const name of metricNames) {
    const common = {
      name,
      help: name.replaceAll('_', ' '),
      labelNames: [...labelKeys],
      registers: [registry]
    };
    instruments.set(
      name,
      name === 'queue_jobs'
        ? new Gauge(common)
        : name.endsWith('_total')
          ? new Counter(common)
          : new Histogram({
              ...common,
              buckets:
                name === 'llm_tokens'
                  ? [100, 500, 1000, 4000, 8000, 16000]
                  : [
                      10, 50, 100, 250, 500, 1000, 2500, 5000, 15000, 30000,
                      60000
                    ]
            })
    );
  }
  function record(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): void {
    if (!metricNames.has(name)) throw new Error('Unknown operational metric');
    if (!Number.isFinite(value)) throw new Error('Metric value must be finite');
    if (value < 0) throw new Error('Metric value must be non-negative');
    const safeLabels = sanitizeLabels(labels);
    const completeLabels = Object.fromEntries(
      [...labelKeys].map((key) => [key, safeLabels[key] ?? 'none'])
    );
    const instrument = instruments.get(name);
    if (instrument instanceof Counter) instrument.inc(completeLabels, value);
    else if (instrument instanceof Histogram)
      instrument.observe(completeLabels, value);
    else if (instrument instanceof Gauge) instrument.set(completeLabels, value);
    logger.info(
      { metric: name, value, labels: safeLabels },
      'Operational metric'
    );
  }

  return {
    text: () => registry.metrics(),
    contentType: registry.contentType,
    gauge(name, value, labels) {
      record(name, value, labels);
    },
    increment(name, labels) {
      record(name, 1, labels);
    },
    observe(name, value, labels) {
      record(name, value, labels);
    }
  };
}
