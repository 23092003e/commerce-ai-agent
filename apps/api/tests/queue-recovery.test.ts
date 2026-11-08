import { describe, expect, it } from 'vitest';
import { recoverPendingEvents } from '../src/services/queue-recovery.js';

describe('queue recovery', () => {
  it('re-enqueues persisted pending events when Redis has lost its jobs', async () => {
    const queued: string[] = [];
    const result = await recoverPendingEvents({
      listPending: async () => ['first', 'second'],
      enqueue: async (key) => {
        queued.push(key);
      }
    });
    expect(queued).toEqual(['first', 'second']);
    expect(result).toEqual({ examined: 2, enqueued: 2, failed: 0 });
  });
  it('continues after one enqueue error so another event is not starved', async () => {
    const queued: string[] = [];
    const result = await recoverPendingEvents({
      listPending: async () => ['broken', 'healthy'],
      enqueue: async (key) => {
        if (key === 'broken') throw new Error('unavailable');
        queued.push(key);
      }
    });
    expect(queued).toEqual(['healthy']);
    expect(result).toEqual({ examined: 2, enqueued: 1, failed: 1 });
  });
});
