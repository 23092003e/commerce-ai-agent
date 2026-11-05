import type { EmbeddingProvider } from './knowledge.js';

interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
type FetchLike = (url: string, init: RequestInit) => Promise<FetchResponse>;

export function createOpenAiEmbeddingProvider(input: {
  apiKey: string;
  model: string;
  baseUrl: string;
  dimensions: number;
  timeoutMs?: number;
  fetch?: FetchLike;
}): EmbeddingProvider {
  if (
    !Number.isInteger(input.dimensions) ||
    input.dimensions < 2 ||
    input.dimensions > 4096
  )
    throw new Error('Embedding dimensions must be an integer from 2 to 4096');
  if (!input.apiKey.trim()) throw new Error('Embedding apiKey is required');
  if (!input.model.trim()) throw new Error('Embedding model is required');
  const timeoutMs = input.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
    throw new Error('Embedding timeout must be an integer from 1 to 120000 ms');
  const baseUrl = new URL(input.baseUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname);
  if (
    (baseUrl.protocol !== 'https:' &&
      !(baseUrl.protocol === 'http:' && local)) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  )
    throw new Error(
      'Embedding baseUrl must use HTTPS or local HTTP without credentials, query or fragment'
    );
  const endpoint = `${baseUrl.toString().replace(/\/+$/u, '')}/embeddings`;
  const fetcher = input.fetch ?? fetch;

  return {
    dimensions: input.dimensions,
    provider: 'openai-compatible',
    model: input.model,
    async embed(text) {
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error('Embedding request timed out'));
          controller.abort();
        }, timeoutMs);
      });
      const request = async () => {
        const response = await fetcher(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${input.apiKey}`,
            'content-type': 'application/json'
          },
          signal: controller.signal,
          redirect: 'error',
          body: JSON.stringify({
            model: input.model,
            input: text,
            dimensions: input.dimensions,
            encoding_format: 'float'
          })
        });
        if (!response.ok)
          throw new Error(
            `Embedding request failed: ${String(response.status)}`
          );
        const payload: unknown = await response.json();
        const data =
          payload && typeof payload === 'object'
            ? (payload as { data?: unknown }).data
            : undefined;
        const first: unknown =
          Array.isArray(data) && data.length === 1 ? data[0] : undefined;
        const vector =
          first && typeof first === 'object'
            ? (first as { embedding?: unknown }).embedding
            : undefined;
        if (
          !Array.isArray(vector) ||
          vector.length !== input.dimensions ||
          !vector.every(
            (value: unknown) =>
              typeof value === 'number' && Number.isFinite(value)
          )
        )
          throw new Error('Embedding provider returned an invalid vector');
        const numbers = vector as number[];
        const maximum = Math.max(...numbers.map(Math.abs));
        if (maximum === 0)
          throw new Error('Embedding provider returned an invalid vector');
        const scaled = numbers.map((value) => value / maximum);
        const magnitude = Math.hypot(...scaled);
        return scaled.map((value) => value / magnitude);
      };
      try {
        return await Promise.race([request(), deadline]);
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}
