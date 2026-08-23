import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  API_URL: z.string().default('http://localhost:4000'),
  WEB_URL: z.string().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/postgres'),
  DATABASE_SSL: z.string().default('false'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  RABBITMQ_URL: z.string().default('amqp://localhost:5672'),
  RABBITMQ_EVENTS_QUEUE: z.string().default('opsmesh.events'),
  RABBITMQ_RETRY_QUEUE: z.string().default('opsmesh.events.retry'),
  RABBITMQ_DLQ: z.string().default('opsmesh.events.dlq'),

  RATE_LIMIT_EVENTS_PER_MINUTE: z.coerce.number().default(1000),
  RATE_LIMIT_API_PER_MINUTE: z.coerce.number().default(120),

  ESCALATION_CHECK_INTERVAL_MS: z.coerce.number().default(15000),
  HEALTH_CHECK_INTERVAL_MS: z.coerce.number().default(30000),

  AI_PROVIDER: z.enum(['disabled', 'openai', 'anthropic']).default('disabled'),
  AI_API_KEY: z.string().optional().default(''),
  AI_MODEL: z.string().optional().default(''),

  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  SMTP_FROM: z.string().default('opsmesh@localhost'),
  SLACK_WEBHOOK_URL: z.string().optional().default('')
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export function getConfig(): AppConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

export function getCorsOrigins(config: AppConfig): string[] {
  return config.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
}