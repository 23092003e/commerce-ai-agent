import { createHmac, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { runConcurrentLoad } from './load-runner.js';
import {
  createLoadPayload,
  percentiles,
  requireAcceptedResponse,
  validateLoadTarget
} from './load-fixture.js';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}
const count = Number(argument('--count') ?? 100);
const concurrency = Number(argument('--concurrency') ?? 10);
const deadlineMs = Number(argument('--timeout-ms') ?? 60_000);
if (!Number.isInteger(deadlineMs) || deadlineMs < 1_000 || deadlineMs > 120_000)
  throw new Error('timeout-ms must be 1000..120000');
const appSecret = process.env.META_APP_SECRET;
const baseUrl = process.env.APP_BASE_URL ?? 'http://127.0.0.1:3000';
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:54322/fanpage_sales_agent_test';
if (!appSecret) throw new Error('META_APP_SECRET is required');
const runLabel = argument('--run-label');
validateLoadTarget(baseUrl, databaseUrl, {
  allowRemote: process.argv.includes('--allow-remote'),
  ...(runLabel ? { label: runLabel } : {})
});
// Refuse to exercise an API whose channel can send customer-visible traffic.
const probe = await fetch(`${baseUrl}/internal/test/meta/outbound`, {
  signal: AbortSignal.timeout(5_000)
});
if (probe.status !== 200)
  throw new Error('Load requires the non-production fake messaging API');
const runId = randomUUID();
const started = new Map<string, number>();
const pool = new Pool({ connectionString: databaseUrl });
try {
  const http = await runConcurrentLoad({
    count,
    concurrency,
    async send(index) {
      const id = `load-${runId}-${String(index)}`;
      const timestamp = Date.now();
      started.set(id, timestamp);
      const raw = JSON.stringify(createLoadPayload(runId, index, timestamp));
      const signature = createHmac('sha256', appSecret)
        .update(raw)
        .digest('hex');
      await requireAcceptedResponse(
        await fetch(`${baseUrl}/webhooks/meta`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-hub-signature-256': `sha256=${signature}`
          },
          body: raw,
          signal: AbortSignal.timeout(10_000)
        })
      );
    }
  });
  interface TerminalRow {
    external_event_key: string;
    processing_state: string;
    processed_at: Date | null;
    final_outcome: string | null;
    delivery_state: string | null;
  }
  let rows: TerminalRow[] = [];
  const deadline = Date.now() + deadlineMs;
  do {
    const result = await pool.query<TerminalRow>(
      `SELECT e.external_event_key, e.processing_state, e.processed_at, r.final_outcome, out.delivery_state
       FROM webhook_events e
       LEFT JOIN messages inbound ON inbound.meta_message_id = substring(e.external_event_key from 14) AND inbound.direction = 'inbound'
       LEFT JOIN agent_runs r ON r.inbound_message_id = inbound.id
       LEFT JOIN messages out ON out.inbound_message_id = inbound.id AND out.direction = 'outbound'
       WHERE e.external_event_key LIKE $1`,
      [`meta:message:load-${runId}-%`]
    );
    rows = result.rows;
    if (
      rows.length === count &&
      rows.every((row) =>
        ['processed', 'ignored', 'failed'].includes(row.processing_state)
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  const terminal = {
    processed: rows.filter((row) => row.processing_state === 'processed')
      .length,
    replied: rows.filter(
      (row) =>
        row.final_outcome === 'replied' &&
        ['sent', 'delivered'].includes(row.delivery_state ?? '')
    ).length,
    handedOver: rows.filter((row) => row.final_outcome === 'handed_over')
      .length,
    failed: rows.filter((row) => row.processing_state === 'failed').length,
    unaccounted:
      count -
      rows.filter((row) =>
        ['processed', 'ignored', 'failed'].includes(row.processing_state)
      ).length
  };
  const latency = rows.flatMap((row) => {
    const time = started.get(
      row.external_event_key.replace('meta:message:', '')
    );
    return time !== undefined && row.processed_at
      ? [Math.max(0, new Date(row.processed_at).getTime() - time)]
      : [];
  });
  process.stdout.write(
    `${JSON.stringify({ runId, http, terminal, completeTurn: percentiles(latency) })}\n`
  );
  if (
    http.failed ||
    terminal.failed ||
    terminal.unaccounted ||
    terminal.processed !== count ||
    terminal.replied + terminal.handedOver !== count
  )
    process.exitCode = 1;
} finally {
  await pool.end();
}
