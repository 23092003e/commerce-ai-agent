import { describe, expect, it } from 'vitest';
import { runConcurrentLoad } from './load-runner.js';

describe('runConcurrentLoad', () => {
  it('bounds parallel sends and reports successful and failed operations', async () => {
    let active = 0;
    let peak = 0;
    const result = await runConcurrentLoad({
      count: 5,
      concurrency: 2,
      async send(index) {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        if (index === 3) throw new Error('expected fixture failure');
      }
    });

    expect(peak).toBe(2);
    expect(result).toMatchObject({ count: 5, succeeded: 4, failed: 1 });
    expect(result.p50Ms).toBeGreaterThanOrEqual(0);
    expect(result.p95Ms).toBeGreaterThanOrEqual(result.p50Ms);
  });

  it('rejects invalid load settings before sending requests', async () => {
    await expect(
      runConcurrentLoad({ count: 0, concurrency: 1, async send() {} })
    ).rejects.toThrow('count must be an integer from 1 to 10000');
  });
});
