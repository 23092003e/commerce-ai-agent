export function createLoadPayload(
  runId: string,
  index: number,
  timestamp: number
) {
  return {
    object: 'page' as const,
    entry: [
      {
        id: `load-page-${runId}`,
        time: timestamp,
        messaging: [
          {
            sender: { id: `load-${runId}-${String(index)}` },
            recipient: { id: `load-page-${runId}` },
            timestamp,
            message: { mid: `load-${runId}-${String(index)}`, text: 'Xin chào' }
          }
        ]
      }
    ]
  };
}

export function validateLoadTarget(
  baseUrl: string,
  databaseUrl: string,
  options: { allowRemote?: boolean; label?: string } = {}
): void {
  const database = new URL(databaseUrl);
  if (database.pathname !== '/fanpage_sales_agent_test')
    throw new Error(
      'Load requires the isolated fanpage_sales_agent_test database'
    );
  const target = new URL(baseUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
  if (
    !['http:', 'https:'].includes(target.protocol) ||
    target.username ||
    target.password
  )
    throw new Error('Invalid load target URL');
  if (
    !local &&
    (!options.allowRemote ||
      !options.label ||
      !/^[a-zA-Z0-9_-]{1,60}$/.test(options.label))
  )
    throw new Error('A remote target requires --allow-remote and --run-label');
}

export async function requireAcceptedResponse(
  response: Response
): Promise<void> {
  if (response.status !== 200)
    throw new Error(`Webhook returned ${String(response.status)}`);
  const body: unknown = await response.json();
  if (
    typeof body !== 'object' ||
    body === null ||
    !('accepted' in body) ||
    body.accepted !== 1
  )
    throw new Error('Expected exactly one accepted event');
}

export function percentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (percentage: number) =>
    sorted.length
      ? Math.round(
          (sorted[Math.ceil(sorted.length * percentage) - 1] ?? 0) * 100
        ) / 100
      : null;
  return { p50Ms: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99) };
}
