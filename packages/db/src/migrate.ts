import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';

export async function runMigrations(
  databaseUrl: string,
  migrationsDirectory: string
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const filenames = (await readdir(migrationsDirectory))
      .filter((filename) => filename.endsWith('.sql'))
      .sort();

    for (const filename of filenames) {
      const migration = await readFile(join(migrationsDirectory, filename), 'utf8');
      const checksum = createHash('sha256').update(migration).digest('hex');
      const existing = await client.query<{ checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE filename = $1',
        [filename]
      );

      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(`Applied migration was modified: ${filename}`);
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(migration);
        await client.query(
          'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
          [filename, checksum]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}
