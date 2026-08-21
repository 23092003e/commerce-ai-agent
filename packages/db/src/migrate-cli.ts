import { fileURLToPath } from 'node:url';
import { runMigrations } from './migrate.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const migrationsDirectory = fileURLToPath(
  new URL('../migrations/', import.meta.url)
);
await runMigrations(databaseUrl, migrationsDirectory);
process.stdout.write('Database migrations are up to date.\n');
