import { z } from 'zod';

function optionalSetting<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (value === '' ? undefined : value),
    schema.optional()
  );
}

const EnvironmentBoolean = z
  .union([z.literal('true'), z.literal('false'), z.boolean()])
  .transform((value) => value === true || value === 'true');

const EnvironmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  META_APP_SECRET: z.string().min(16),
  META_VERIFY_TOKEN: z.string().min(16),
  META_ADAPTER: z.enum(['fake', 'graph']).default('fake'),
  META_PAGE_ACCESS_TOKEN: optionalSetting(z.string().min(1)),
  META_GRAPH_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/u)
    .default('v23.0'),
  AI_PROVIDER: z.enum(['fake', 'openai', 'openrouter']).default('fake'),
  AI_MODEL: optionalSetting(z.string().trim().min(1)),
  AI_API_KEY: optionalSetting(z.string().min(1)),
  EMBEDDING_PROVIDER: z
    .enum(['deterministic', 'openai-compatible'])
    .default('deterministic'),
  EMBEDDING_MODEL: optionalSetting(z.string().trim().min(1)),
  EMBEDDING_API_KEY: optionalSetting(z.string().trim().min(1)),
  EMBEDDING_BASE_URL: optionalSetting(z.url()),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().min(2).max(4096).default(8),
  HUMAN_REPLY_DELAY_ENABLED: EnvironmentBoolean.default(true),
  HUMAN_REPLY_DELAY_MIN_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(10_000)
    .default(800),
  HUMAN_REPLY_DELAY_MAX_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(10_000)
    .default(2600),
  HUMAN_REPLY_TYPING_CHARS_PER_SECOND: z.coerce
    .number()
    .positive()
    .max(100)
    .default(20),
  ADMIN_AUTH_SECRET: optionalSetting(z.string().min(32)),
  METRICS_AUTH_SECRET: optionalSetting(z.string().min(32)),
  APP_BASE_URL: optionalSetting(z.url()),
  ADMIN_ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    ),
  ADMIN_LEGACY_BEARER_ENABLED: EnvironmentBoolean.default(false),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info')
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const config = EnvironmentSchema.parse(environment);
  function validateOrigin(value: string) {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      (url.protocol !== 'https:' &&
        !(
          config.NODE_ENV !== 'production' &&
          local &&
          url.protocol === 'http:'
        ))
    )
      throw new Error(
        'Admin origins must use HTTPS without credentials, path, query or fragment (localhost HTTP permitted outside production)'
      );
    return url.origin;
  }
  if (config.APP_BASE_URL) validateOrigin(config.APP_BASE_URL);
  for (const origin of config.ADMIN_ALLOWED_ORIGINS) validateOrigin(origin);
  if (config.NODE_ENV === 'production') {
    if (!config.APP_BASE_URL)
      throw new Error('APP_BASE_URL is required in production');
    if (config.ADMIN_LEGACY_BEARER_ENABLED)
      throw new Error('Legacy Admin bearer is forbidden in production');
    if (
      config.ADMIN_ALLOWED_ORIGINS.some(
        (origin) =>
          validateOrigin(origin) !== new URL(config.APP_BASE_URL ?? '').origin
      )
    )
      throw new Error('Production Admin must use the APP_BASE_URL origin');
  }
  if (config.NODE_ENV === 'production') {
    if (config.AI_PROVIDER === 'fake')
      throw new Error('AI_PROVIDER must be real in production');
    if (config.META_ADAPTER !== 'graph')
      throw new Error('META_ADAPTER must be graph in production');
    if (
      config.EMBEDDING_PROVIDER !== 'openai-compatible' ||
      !environment.EMBEDDING_PROVIDER
    )
      throw new Error(
        'EMBEDDING_PROVIDER must be explicitly openai-compatible in production'
      );
    if (!environment.EMBEDDING_DIMENSIONS)
      throw new Error('EMBEDDING_DIMENSIONS must be explicit in production');
    if (!config.ADMIN_AUTH_SECRET)
      throw new Error('ADMIN_AUTH_SECRET is required in production');
    if (!config.METRICS_AUTH_SECRET)
      throw new Error('METRICS_AUTH_SECRET is required in production');
    for (const name of [
      'META_APP_SECRET',
      'META_VERIFY_TOKEN',
      'META_PAGE_ACCESS_TOKEN',
      'AI_API_KEY',
      'EMBEDDING_API_KEY',
      'ADMIN_AUTH_SECRET'
    ] as const) {
      const value = config[name];
      if (value !== undefined && !value.trim())
        throw new Error(`${name} must not be blank in production`);
      if (
        value &&
        /^(?:replace(?:[-_ ]|$)|your(?:[-_ ]|$)|change[-_ ]?me|placeholder|example|test[-_ ]|dummy|todo)/iu.test(
          value.trim()
        )
      )
        throw new Error(`${name} must not be a placeholder in production`);
    }
  }
  if (config.EMBEDDING_PROVIDER === 'openai-compatible') {
    for (const name of [
      'EMBEDDING_MODEL',
      'EMBEDDING_API_KEY',
      'EMBEDDING_BASE_URL'
    ] as const) {
      if (!config[name])
        throw new Error(
          `${name} is required for EMBEDDING_PROVIDER=openai-compatible`
        );
    }
    const baseUrl = config.EMBEDDING_BASE_URL;
    if (!baseUrl) throw new Error('EMBEDDING_BASE_URL is required');
    const url = new URL(baseUrl);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' &&
        !(
          config.NODE_ENV !== 'production' &&
          url.protocol === 'http:' &&
          local
        )) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        'EMBEDDING_BASE_URL must use HTTPS (local HTTP is permitted outside production) without credentials, query or fragment'
      );
  }
  if (config.META_ADAPTER === 'graph' && !config.META_PAGE_ACCESS_TOKEN) {
    throw new Error(
      'META_PAGE_ACCESS_TOKEN is required for META_ADAPTER=graph'
    );
  }
  if (
    config.AI_PROVIDER !== 'fake' &&
    (!config.AI_MODEL || !config.AI_API_KEY)
  ) {
    throw new Error(
      'AI_MODEL and AI_API_KEY are required for a real AI provider'
    );
  }
  if (config.HUMAN_REPLY_DELAY_MAX_MS < config.HUMAN_REPLY_DELAY_MIN_MS) {
    throw new Error(
      'HUMAN_REPLY_DELAY_MAX_MS must be at least HUMAN_REPLY_DELAY_MIN_MS'
    );
  }
  return config;
}
