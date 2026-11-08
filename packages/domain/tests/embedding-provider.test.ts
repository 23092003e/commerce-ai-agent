import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAiEmbeddingProvider } from '../src/embedding-provider.js';

const options = {
  apiKey: 'embedding-secret',
  model: 'embedding-model',
  baseUrl: 'https://embeddings.example/v1/',
  dimensions: 2
};

afterEach(() => vi.useRealTimers());

describe('OpenAI-compatible embeddings', () => {
  it('sends the explicit model, dimensions and separate bearer credential', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ embedding: [3, 4] }] }))
    );
    const provider = createOpenAiEmbeddingProvider({
      ...options,
      fetch: fetcher
    });
    expect(provider.dimensions).toBe(2);
    expect(await provider.embed('knowledge text')).toEqual([0.6, 0.8]);
    expect(fetcher).toHaveBeenCalledWith(
      'https://embeddings.example/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: {
          authorization: 'Bearer embedding-secret',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'embedding-model',
          input: 'knowledge text',
          dimensions: 2,
          encoding_format: 'float'
        })
      })
    );
  });

  it.each([
    {},
    { data: [] },
    { data: [{ embedding: [1] }] },
    { data: [{ embedding: ['1', 2] }] },
    { data: [{ embedding: [0, 0] }] },
    { data: [{ embedding: [Infinity, 1] }] },
    { data: [{ embedding: [NaN, 1] }] }
  ])('rejects malformed or unusable vectors: %j', async (payload) => {
    const provider = createOpenAiEmbeddingProvider({
      ...options,
      fetch: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => payload
      }))
    });
    await expect(provider.embed('query')).rejects.toThrow('invalid vector');
  });

  it('does not expose response bodies on upstream errors', async () => {
    const provider = createOpenAiEmbeddingProvider({
      ...options,
      fetch: vi.fn(
        async () => new Response('private upstream detail', { status: 429 })
      )
    });
    await expect(provider.embed('query')).rejects.toThrow(
      'Embedding request failed: 429'
    );
  });

  it('aborts and rejects a stalled request after the configured timeout', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new Error('aborted'))
          );
        })
    );
    const provider = createOpenAiEmbeddingProvider({
      ...options,
      fetch: fetcher,
      timeoutMs: 50
    });
    const result = expect(provider.embed('query')).rejects.toThrow(
      'Embedding request timed out'
    );
    await vi.advanceTimersByTimeAsync(50);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, 1, 4097, 2.5, NaN])(
    'rejects invalid dimensions %s before fetching',
    (dimensions) => {
      expect(() =>
        createOpenAiEmbeddingProvider({ ...options, dimensions })
      ).toThrow('dimensions');
    }
  );

  it('rejects invalid factory settings before fetching', () => {
    expect(() =>
      createOpenAiEmbeddingProvider({ ...options, timeoutMs: 0 })
    ).toThrow('timeout');
    expect(() =>
      createOpenAiEmbeddingProvider({ ...options, apiKey: ' ' })
    ).toThrow('apiKey');
    expect(() =>
      createOpenAiEmbeddingProvider({ ...options, model: ' ' })
    ).toThrow('model');
    expect(() =>
      createOpenAiEmbeddingProvider({
        ...options,
        baseUrl: 'ftp://example.com'
      })
    ).toThrow('baseUrl');
  });

  it('bounds a stalled response body even when fetch ignores abort', async () => {
    vi.useFakeTimers();
    const provider = createOpenAiEmbeddingProvider({
      ...options,
      timeoutMs: 20,
      fetch: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: () => new Promise<unknown>(() => {})
      }))
    });
    const result = expect(provider.embed('query')).rejects.toThrow(
      'Embedding request timed out'
    );
    await vi.advanceTimersByTimeAsync(20);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('normalizes large finite coordinates without overflow', async () => {
    const provider = createOpenAiEmbeddingProvider({
      ...options,
      fetch: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ embedding: [Number.MAX_VALUE, Number.MAX_VALUE] }]
        })
      }))
    });
    const vector = await provider.embed('query');
    expect(vector[0]).toBeCloseTo(Math.SQRT1_2);
    expect(vector[1]).toBeCloseTo(Math.SQRT1_2);
  });
});
