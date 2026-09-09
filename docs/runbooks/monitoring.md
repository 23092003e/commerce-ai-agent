# Monitoring Runbook

The API writes structured operational metrics through Pino. Metric labels are
allowlisted; customer identifiers, message content, prompts, phone numbers,
and email addresses must never be attached to a metric.

## Metrics and alerts

| Metric                              | Alert condition                                                       | First response                                                                               |
| ----------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `webhook_validation_failures_total` | Any sustained increase for 10 minutes                                 | Check Meta app secret and callback traffic; do not disable signature validation.             |
| `worker_duration_ms`                | p95 exceeds 30 seconds for 10 minutes                                 | Check Redis connectivity and delayed/failed jobs.                                            |
| `agent_latency_ms`                  | p95 exceeds 15 seconds for 10 minutes                                 | Check AI provider status and model timeout errors.                                           |
| `llm_errors_total`                  | More than 5 errors in 5 minutes                                       | Verify provider credentials and use the configured fallback/handover path.                   |
| `tool_errors_total`                 | More than 5 errors in 5 minutes                                       | Identify the tool by the allowlisted `toolName` label and inspect its dependency.            |
| `meta_send_errors_total`            | Any `authentication` error, or rate-limit/server errors for 5 minutes | Rotate/revalidate the Page token for authentication; throttle outbound work for rate limits. |
| `handovers_total`                   | More than 20% of inbound messages for 30 minutes                      | Staff should inspect the reason distribution and customer queue.                             |
| `rag_no_evidence_total`             | More than 10% of policy questions for 30 minutes                      | Review and index approved knowledge; do not invent a policy answer.                          |
| `checkout_completions_total`        | Drops to zero during business hours                                   | Check inventory, confirmation flow, and Meta delivery failures.                              |

## Triage rules

1. Correlate records using `trace_id`, `webhook_event_id`, `conversation_id`,
   `message_id`, and `agent_run_id`; never add customer content as a label.
2. For Meta send failures, retry only records marked retryable by the channel.
   Terminal failures create a handover for staff.
3. Record the incident time, metric, observed error code, and corrective action
   in the operations log. Do not copy tokens or raw webhook payloads.
