import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/index.js';

const base = {
  DATABASE_URL: 'postgres://localhost/test',
  REDIS_URL: 'redis://localhost:6379',
  META_APP_SECRET: 'a'.repeat(16),
  META_VERIFY_TOKEN: 'b'.repeat(16)
};
describe('AI config', () => {
  it('allows fake provider without credentials and rejects incomplete real provider config', () => {
    expect(loadConfig(base).AI_PROVIDER).toBe('fake');
    expect(() =>
      loadConfig({ ...base, AI_PROVIDER: 'openai', AI_MODEL: 'gpt-test' })
    ).toThrow('AI_MODEL and AI_API_KEY');
    expect(
      loadConfig({
        ...base,
        AI_PROVIDER: 'openrouter',
        AI_MODEL: 'deepseek/deepseek-chat',
        AI_API_KEY: 'key'
      }).AI_PROVIDER
    ).toBe('openrouter');
    expect(loadConfig(base).HUMAN_REPLY_DELAY_MIN_MS).toBe(800);
    expect(
      loadConfig({ ...base, HUMAN_REPLY_DELAY_ENABLED: 'false' })
        .HUMAN_REPLY_DELAY_ENABLED
    ).toBe(false);
    expect(() =>
      loadConfig({
        ...base,
        HUMAN_REPLY_DELAY_MIN_MS: '900',
        HUMAN_REPLY_DELAY_MAX_MS: '800'
      })
    ).toThrow('HUMAN_REPLY_DELAY_MAX_MS');
  });
});

const production = {
  ...base,
  APP_BASE_URL: 'https://commerce.example',
  METRICS_AUTH_SECRET: 'metrics-private-key-with-at-least-32-characters',
  NODE_ENV: 'production',
  META_ADAPTER: 'graph',
  META_PAGE_ACCESS_TOKEN: 'meta-private-token',
  AI_PROVIDER: 'openai',
  AI_MODEL: 'decision-model',
  AI_API_KEY: 'ai-private-key',
  ADMIN_AUTH_SECRET: 'admin-private-key-with-at-least-32-characters',
  EMBEDDING_PROVIDER: 'openai-compatible',
  EMBEDDING_MODEL: 'text-embedding-3-small',
  EMBEDDING_API_KEY: 'embedding-private-key',
  EMBEDDING_BASE_URL: 'https://api.openai.com/v1',
  EMBEDDING_DIMENSIONS: '1536'
};

describe('production configuration', () => {
  it('enforces an explicit HTTPS same-origin Admin boundary', () => {
    expect(() =>
      loadConfig({ ...production, APP_BASE_URL: undefined })
    ).toThrow('APP_BASE_URL');
    expect(() =>
      loadConfig({ ...production, APP_BASE_URL: 'http://commerce.example' })
    ).toThrow('HTTPS');
    expect(() =>
      loadConfig({ ...production, ADMIN_ALLOWED_ORIGINS: '*' })
    ).toThrow();
    expect(() =>
      loadConfig({
        ...production,
        ADMIN_ALLOWED_ORIGINS: 'https://elsewhere.example'
      })
    ).toThrow('APP_BASE_URL');
    expect(() =>
      loadConfig({ ...production, ADMIN_LEGACY_BEARER_ENABLED: 'true' })
    ).toThrow('bearer');
    expect(
      loadConfig({
        ...base,
        APP_BASE_URL: 'http://localhost:3000',
        ADMIN_ALLOWED_ORIGINS: 'http://localhost:5173'
      }).ADMIN_ALLOWED_ORIGINS
    ).toEqual(['http://localhost:5173']);
    expect(loadConfig(base).ADMIN_LEGACY_BEARER_ENABLED).toBe(false);
  });
  it('allows blank optional provider settings in development example environments', () => {
    expect(
      loadConfig({
        ...base,
        AI_MODEL: '',
        AI_API_KEY: '',
        META_PAGE_ACCESS_TOKEN: '',
        EMBEDDING_MODEL: '',
        EMBEDDING_API_KEY: '',
        EMBEDDING_BASE_URL: '',
        ADMIN_AUTH_SECRET: ''
      }).EMBEDDING_PROVIDER
    ).toBe('deterministic');
  });
  it('accepts explicit real providers and keeps development defaults', () => {
    expect(loadConfig(production).EMBEDDING_DIMENSIONS).toBe(1536);
    expect(loadConfig(base).EMBEDDING_PROVIDER).toBe('deterministic');
    expect(loadConfig(base).EMBEDDING_DIMENSIONS).toBe(8);
  });

  it.each([
    ['AI_PROVIDER', 'fake'],
    ['META_ADAPTER', 'fake'],
    ['EMBEDDING_PROVIDER', 'deterministic'],
    ['ADMIN_AUTH_SECRET', undefined],
    ['EMBEDDING_PROVIDER', undefined],
    ['EMBEDDING_MODEL', undefined],
    ['EMBEDDING_API_KEY', undefined],
    ['EMBEDDING_BASE_URL', undefined],
    ['EMBEDDING_DIMENSIONS', undefined],
    ['EMBEDDING_DIMENSIONS', '0'],
    ['EMBEDDING_DIMENSIONS', '4097'],
    ['EMBEDDING_DIMENSIONS', '2.5'],
    ['EMBEDDING_BASE_URL', 'http://localhost:9000/v1'],
    ['EMBEDDING_BASE_URL', 'http://remote.example/v1'],
    ['EMBEDDING_BASE_URL', 'https://user:password@example.com/v1'],
    ['AI_API_KEY', 'replace-with-api-key'],
    ['META_APP_SECRET', 'replace-with-at-least-16-characters'],
    ['META_PAGE_ACCESS_TOKEN', 'your-token'],
    ['ADMIN_AUTH_SECRET', 'replace-with-at-least-32-characters'],
    ['EMBEDDING_API_KEY', 'changeme']
  ])('rejects unsafe %s=%s', (key, value) => {
    expect(() => loadConfig({ ...production, [key]: value })).toThrow(key);
  });

  it.each([
    'AI_API_KEY',
    'META_PAGE_ACCESS_TOKEN',
    'META_APP_SECRET',
    'META_VERIFY_TOKEN',
    'ADMIN_AUTH_SECRET'
  ])('rejects blank production %s', (name) => {
    expect(() => loadConfig({ ...production, [name]: ' '.repeat(40) })).toThrow(
      name
    );
  });

  it('permits local HTTP embedding endpoints only outside production', () => {
    expect(
      loadConfig({
        ...production,
        NODE_ENV: 'test',
        EMBEDDING_BASE_URL: 'http://localhost:9000/v1'
      }).EMBEDDING_BASE_URL
    ).toBe('http://localhost:9000/v1');
    expect(() =>
      loadConfig({
        ...production,
        NODE_ENV: 'development',
        EMBEDDING_BASE_URL: 'http://remote.example/v1'
      })
    ).toThrow('EMBEDDING_BASE_URL');
  });
});
