import { describe, expect, it, vi } from 'vitest';
const captured = vi.hoisted(() => ({
  processor: undefined as
    | undefined
    | ((job: {
        data: { eventKey: string };
        opts: { attempts: number };
        attemptsMade: number;
      }) => Promise<void>),
  listeners: new Map<string, (...args: unknown[]) => unknown>()
}));
vi.mock('ioredis', () => ({
  Redis: class {
    disconnect() {}
  }
}));
vi.mock('bullmq', () => ({
  DelayedError: class extends Error {},
  Worker: class {
    constructor(_name: string, processor: typeof captured.processor) {
      captured.processor = processor;
    }
    on(name: string, listener: (...args: unknown[]) => unknown) {
      captured.listeners.set(name, listener);
    }
    emit(name: string, value: unknown) {
      captured.listeners.get(name)?.(value);
    }
  }
}));
import { startBullMqEventWorker } from '../src/worker.js';

function processor() {
  if (!captured.processor) throw new Error('Processor was not created');
  return captured.processor;
}

describe('queue terminal finalization', () => {
  it('awaits finalization once only on the last attempt; failed notification does not finalize again', async () => {
    let finalizations = 0;
    const error = new Error('job failure');
    startBullMqEventWorker('redis://local', {
      async process() {
        throw error;
      },
      async onFinalFailure() {
        finalizations += 1;
      }
    });
    const job = {
      data: { eventKey: 'event' },
      opts: { attempts: 2 },
      attemptsMade: 0,
      async getState() {
        return 'failed';
      }
    };
    await expect(processor()(job)).rejects.toBe(error);
    expect(finalizations).toBe(0);
    job.attemptsMade = 1;
    await expect(processor()(job)).rejects.toBe(error);
    await captured.listeners.get('failed')?.(job, error);
    expect(finalizations).toBe(1);
  });
  it('preserves the original error when the finalizer fails', async () => {
    const error = new Error('job failure');
    const failures: unknown[] = [];
    startBullMqEventWorker('redis://local', {
      async process() {
        throw error;
      },
      async onFinalFailure() {
        throw new Error('finalizer failure');
      }
    });
    captured.listeners.set('error', (failure) => failures.push(failure));
    await expect(
      processor()({
        data: { eventKey: 'event' },
        opts: { attempts: 1 },
        attemptsMade: 0
      })
    ).rejects.toBe(error);
    expect(failures).toHaveLength(1);
  });
});
