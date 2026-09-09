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
  'orders_total'
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
  | 'orders_total';

export interface MetricLogger {
  info(bindings: Record<string, unknown>, message: string): void;
}

export interface OperationalMetrics {
  increment(name: string, labels?: Record<string, string>): void;
  observe(name: string, value: number, labels?: Record<string, string>): void;
}

function sanitizeLabels(
  labels: Record<string, string> = {}
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(labels).filter(
      ([key, value]) => labelKeys.has(key) && value.length <= 100
    )
  );
}

export function createOperationalMetrics(
  logger: MetricLogger
): OperationalMetrics {
  function record(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): void {
    if (!metricNames.has(name)) throw new Error('Unknown operational metric');
    if (!Number.isFinite(value)) throw new Error('Metric value must be finite');
    logger.info(
      { metric: name, value, labels: sanitizeLabels(labels) },
      'Operational metric'
    );
  }

  return {
    increment(name, labels) {
      record(name, 1, labels);
    },
    observe(name, value, labels) {
      record(name, value, labels);
    }
  };
}
