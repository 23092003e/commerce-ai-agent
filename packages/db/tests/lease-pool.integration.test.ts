import { expect, it } from 'vitest';
import { PostgresCommerceRepository } from '../src/index.js';

it('allows ten concurrent leased turns to make database queries without pool starvation', async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const repo = new PostgresCommerceRepository(databaseUrl);
  let entered = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        repo.withConversationLease(`lease-pool-${String(index)}`, async () => {
          if (++entered === 10) release();
          await barrier;
          await Promise.race([
            repo.ping(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('database pool starved')), 1500)
            )
          ]);
        })
      )
    );
    expect(entered).toBe(10);
  } finally {
    await repo.close();
  }
});
