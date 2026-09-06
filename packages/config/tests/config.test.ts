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
  });
});
