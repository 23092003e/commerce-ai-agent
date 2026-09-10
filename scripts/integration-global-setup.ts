import { Client } from 'pg';

const defaultDatabaseUrl =
  'postgres://postgres:postgres@localhost:54322/fanpage_sales_agent';
const testDatabaseName = 'fanpage_sales_agent_test';

function testDatabaseUrl(): string {
  const url = new URL(process.env.DATABASE_URL ?? defaultDatabaseUrl);
  url.pathname = `/${testDatabaseName}`;
  return url.toString();
}

export default async function setupIntegrationDatabase(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL ?? defaultDatabaseUrl);
  url.pathname = '/postgres';
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    const exists = await admin.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
      [testDatabaseName]
    );
    if (!exists.rows[0]?.exists) {
      await admin.query(`CREATE DATABASE ${testDatabaseName}`);
    }
  } finally {
    await admin.end();
  }

  const databaseUrl = testDatabaseUrl();
  process.env.DATABASE_URL = databaseUrl;
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    await database.query('DROP SCHEMA public CASCADE');
    await database.query('CREATE SCHEMA public');
    await database.query('GRANT ALL ON SCHEMA public TO public');
  } finally {
    await database.end();
  }
}
