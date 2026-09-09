import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runConcurrentLoad } from './load-runner.js';

function option(name: string, fallback: number): number {
  const position = process.argv.indexOf(name);
  const value = position === -1 ? undefined : process.argv[position + 1];
  return value === undefined ? fallback : Number(value);
}

const count = option('--count', 100);
const concurrency = option('--concurrency', 10);
const fixturePath = resolve('apps/api/tests/fixtures/text-message.json');
const appSecret = process.env.META_APP_SECRET;
const baseUrl = process.env.APP_BASE_URL ?? 'http://127.0.0.1:3000';
if (!appSecret) throw new Error('META_APP_SECRET is required');

const fixture: unknown = JSON.parse(await readFile(fixturePath, 'utf8'));
if (
  typeof fixture !== 'object' ||
  fixture === null ||
  !Array.isArray((fixture as { entry?: unknown }).entry)
) {
  throw new Error('Webhook fixture must contain entry records');
}

const summary = await runConcurrentLoad({
  count,
  concurrency,
  async send(index) {
    const payload = structuredClone(fixture) as {
      entry: Array<{
        messaging: Array<{
          sender: { id: string };
          message: { mid: string };
        }>;
      }>;
    };
    const message = payload.entry[0]?.messaging[0];
    if (!message) throw new Error('Webhook fixture must contain one message');
    message.sender.id = `load-customer-${String(index)}`;
    message.message.mid = `load-message-${String(index)}`;
    const raw = JSON.stringify(payload);
    const signature = createHmac('sha256', appSecret).update(raw).digest('hex');
    const response = await fetch(`${baseUrl}/webhooks/meta`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${signature}`
      },
      body: raw,
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok)
      throw new Error(`Webhook returned ${String(response.status)}`);
  }
});

process.stdout.write(`${JSON.stringify(summary)}\n`);
if (summary.failed > 0) process.exitCode = 1;
