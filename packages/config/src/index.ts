import { z } from 'zod';

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
  META_PAGE_ACCESS_TOKEN: z.string().optional(),
  META_GRAPH_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/u)
    .default('v23.0'),
  AI_PROVIDER: z.enum(['fake', 'openai', 'openrouter']).default('fake'),
  AI_MODEL: z.string().trim().min(1).optional(),
  AI_API_KEY: z.string().min(1).optional(),
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
  ADMIN_AUTH_SECRET: z.string().min(32).optional(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info')
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const config = EnvironmentSchema.parse(environment);
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
