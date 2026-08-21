import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const fixturePath = resolve(
  process.argv[2] ?? 'apps/api/tests/fixtures/text-message.json'
);
const appSecret = process.env.META_APP_SECRET;
const baseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000';

if (!appSecret) throw new Error('META_APP_SECRET is required');

const payload = await readFile(fixturePath, 'utf8');
const signature = createHmac('sha256', appSecret).update(payload).digest('hex');
const response = await fetch(`${baseUrl}/webhooks/meta`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-hub-signature-256': `sha256=${signature}`
  },
  body: payload,
  signal: AbortSignal.timeout(10_000)
});

process.stdout.write(`${response.status} ${await response.text()}\n`);
if (!response.ok) process.exitCode = 1;
