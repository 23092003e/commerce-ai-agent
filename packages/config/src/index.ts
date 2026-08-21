import { z } from 'zod';

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
  return config;
}
