import { z } from 'zod';

/**
 * Environment contract. Parsed once, at boot.
 *
 * A missing or placeholder value fails here with a readable message rather than
 * surfacing as a confusing runtime error three layers down at the first query.
 */

const PLACEHOLDER_MARKERS = ['placeholder', 'change-me', 'your-', 'xxx'];

const isPlaceholder = (value: string) =>
  PLACEHOLDER_MARKERS.some((marker) => value.toLowerCase().includes(marker));

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  CLIENT_SLUG: z.string().min(1).default('MASTER'),
  CLIENT_NAME: z.string().min(1).default('Master Template'),
  APP_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  STORAGE_PROVIDER: z.enum(['supabase', 'google_drive', 'local']).default('local'),
  SUPABASE_STORAGE_BUCKET: z.string().default('vo-documents'),
  LOCAL_STORAGE_ROOT: z.string().default('./.uploads'),
  GOOGLE_DRIVE_AUTH_MODE: z.enum(['service_account', 'oauth']).default('oauth'),
  GOOGLE_DRIVE_ROOT_FOLDER_ID: z.string().default(''),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().default(''),
  GOOGLE_OAUTH_CLIENT_ID: z.string().default(''),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().default(''),
  GOOGLE_OAUTH_REFRESH_TOKEN: z.string().default(''),

  EMBEDDING_PROVIDER: z.enum(['mock', 'local', 'voyage']).default('local'),
  VOYAGE_API_KEY: z.string().default(''),

  JOB_DRIVER: z.enum(['memory', 'bullmq']).default('memory'),
  REDIS_URL: z.string().default(''),

  AI_PROVIDER: z.enum(['mock', 'claude']).default('mock'),
  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5'),

  N8N_BASE_URL: z.string().default(''),
  N8N_WEBHOOK_SECRET: z.string().min(8),
  N8N_OUTBOUND_SECRET: z.string().default(''),
  N8N_NOTIFY_EMAIL_URL: z.string().default(''),
  N8N_NOTIFY_WHATSAPP_URL: z.string().default(''),
  N8N_DOCUMENT_MOVE_URL: z.string().default(''),
  N8N_REPORT_DELIVERY_URL: z.string().default(''),

  SEED_CREATE_DRIVE_FOLDERS: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(2555),
});

export type ServerEnv = z.infer<typeof serverSchema>;

function parseEnv(): ServerEnv {
  const parsed = serverSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\n` +
        'Copy .env.example to .env and fill it in. See DEPLOYMENT_GUIDE.md.',
    );
  }

  const env = parsed.data;

  // Placeholders are fine locally while building against no database. They are
  // never fine in production, where they would mean a half-configured deploy
  // silently pointing at nothing.
  if (env.NODE_ENV === 'production') {
    const suspect = (
      [
        ['DATABASE_URL', env.DATABASE_URL],
        ['NEXT_PUBLIC_SUPABASE_URL', env.NEXT_PUBLIC_SUPABASE_URL],
        ['NEXT_PUBLIC_SUPABASE_ANON_KEY', env.NEXT_PUBLIC_SUPABASE_ANON_KEY],
        ['SUPABASE_SERVICE_ROLE_KEY', env.SUPABASE_SERVICE_ROLE_KEY],
        ['N8N_WEBHOOK_SECRET', env.N8N_WEBHOOK_SECRET],
      ] as const
    )
      .filter(([, value]) => isPlaceholder(value))
      .map(([name]) => name);

    if (suspect.length > 0) {
      throw new Error(
        `Refusing to start in production with placeholder values: ${suspect.join(', ')}`,
      );
    }
  }

  if (env.STORAGE_PROVIDER === 'google_drive' && env.GOOGLE_DRIVE_ROOT_FOLDER_ID === '') {
    throw new Error('STORAGE_PROVIDER=google_drive requires GOOGLE_DRIVE_ROOT_FOLDER_ID');
  }
  if (env.STORAGE_PROVIDER === 'supabase' && env.SUPABASE_STORAGE_BUCKET === '') {
    throw new Error('STORAGE_PROVIDER=supabase requires SUPABASE_STORAGE_BUCKET');
  }
  if (env.STORAGE_PROVIDER === 'google_drive' && env.GOOGLE_DRIVE_AUTH_MODE === 'oauth') {
    const missing = (
      [
        ['GOOGLE_OAUTH_CLIENT_ID', env.GOOGLE_OAUTH_CLIENT_ID],
        ['GOOGLE_OAUTH_CLIENT_SECRET', env.GOOGLE_OAUTH_CLIENT_SECRET],
        ['GOOGLE_OAUTH_REFRESH_TOKEN', env.GOOGLE_OAUTH_REFRESH_TOKEN],
      ] as const
    )
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(`GOOGLE_DRIVE_AUTH_MODE=oauth requires ${missing.join(', ')}`);
    }
  }
  if (env.JOB_DRIVER === 'bullmq' && env.REDIS_URL === '') {
    throw new Error('JOB_DRIVER=bullmq requires REDIS_URL');
  }
  if (env.EMBEDDING_PROVIDER === 'voyage' && env.VOYAGE_API_KEY === '') {
    throw new Error('EMBEDDING_PROVIDER=voyage requires VOYAGE_API_KEY');
  }
  if (env.AI_PROVIDER === 'claude' && env.ANTHROPIC_API_KEY === '') {
    throw new Error('AI_PROVIDER=claude requires ANTHROPIC_API_KEY');
  }

  return env;
}

let cached: ServerEnv | undefined;

export function getEnv(): ServerEnv {
  cached ??= parseEnv();
  return cached;
}
