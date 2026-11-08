import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateReleaseEvidence } from './verify-release-core.js';

const evidencePath = process.argv[2];
if (!evidencePath || evidencePath.startsWith('-'))
  throw new Error('Usage: pnpm verify:release <release-evidence.json>');
const git = (...args: string[]) =>
  execFileSync('git', args, { encoding: 'utf8' }).trim();
const migrations: Record<string, string> = {};
for (const filename of readdirSync('packages/db/migrations').filter((file) =>
  file.endsWith('.sql')
)) {
  migrations[filename] = createHash('sha256')
    .update(readFileSync(join('packages/db/migrations', filename)))
    .digest('hex');
}
const errors = validateReleaseEvidence(
  JSON.parse(readFileSync(evidencePath, 'utf8')),
  {
    sha: git('rev-parse', 'HEAD'),
    dirty: git('status', '--porcelain', '--untracked-files=normal').length > 0,
    now: Date.now(),
    migrations
  }
);
if (errors.length) {
  process.stderr.write(`Release rejected: ${errors.join(', ')}\n`);
  process.exitCode = 1;
} else
  process.stdout.write(
    'Local release evidence matches the clean source revision. Public deployment and Meta activation still require live evidence.\n'
  );
