import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { runMigrations } from '../src/migrate.js';

it('serializes two simultaneous startup migrations on the same database', async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const dir = await mkdtemp(join(tmpdir(), 'migration-race-'));
  const table = `migration_test_${randomUUID().replaceAll('-', '')}`;
  try {
    await writeFile(
      join(dir, `${table}.sql`),
      `SELECT pg_sleep(0.2); CREATE TABLE ${table} (id int);`
    );
    await expect(
      Promise.all([runMigrations(url, dir), runMigrations(url, dir)])
    ).resolves.toHaveLength(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
