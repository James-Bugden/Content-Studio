import 'server-only';
import { z } from 'zod';

/**
 * Server environment (CS-001). Parsed once; errors name variables, never values.
 * Values are never logged, returned by health output or sent to the browser.
 */
export const schema = z.object({
  CS_DATA_MODE: z.enum(['fake', 'live']).default('fake'),
  CS_PARITY_WINDOW_WAIVED: z.literal('2026-10-25').optional(),
  CS_CONTENT_STORE: z.enum(['sheet', 'db-shadow', 'db-read', 'db']).default('sheet'),
    CS_CONTENT_WRITE_ENABLED: z.enum(['true', 'false']).optional(),
  APP_BASE_URL: z.string().url().optional(),
  APP_TIMEZONE: z.literal('Asia/Taipei').default('Asia/Taipei'),
  AUTH_SECRET: z.string().min(32).optional(),
  AUTH_GOOGLE_ID: z.string().min(1).optional(),
  AUTH_GOOGLE_SECRET: z.string().min(1).optional(),
  CS_OWNER_GOOGLE_SUB: z.string().regex(/^\d{5,40}$/).optional(),
  CS_OWNER_EMAIL: z.string().email().optional(),
  CS_VIEWER_GOOGLE_SUBS: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().min(1).optional(),
  GOOGLE_WRITE_ENABLED: z.enum(['true', 'false']).default('false'),
  CS_SHEET_ID: z.string().regex(/^[A-Za-z0-9_-]{20,}$/).optional(),
  CS_DRIVE_ROOT_FOLDER_ID: z.string().regex(/^[A-Za-z0-9_-]{10,}$/).optional(),
  /** Drive folder that receives rendered visual assets (CS-012). */
  CS_ASSET_FOLDER_ID: z.string().regex(/^[A-Za-z0-9_-]{10,}$/).optional(),
  CS_HOOK_REFERENCE_FILE_IDS: z.string().optional(),
  TYPEFULLY_API_KEY: z.string().min(1).optional(),
  TYPEFULLY_SOCIAL_SET_ID: z.string().min(1).optional(),
  SUPABASE_READ_MODEL_MODE: z.enum(['off', 'mirror', 'shadow']).default('off'),
  SUPABASE_READ_MODEL_URL: z.string().optional(),
  SUPABASE_READ_MODEL_SERVICE_KEY: z.string().optional(),
  SUPABASE_READ_MODEL_SOURCE_KEY: z.string().regex(/^[a-z0-9][a-z0-9_-]{7,63}$/).optional(),
  RESOURCE_BASE_URL: z.string().url().optional(),
  CRON_SECRET: z.string().min(16).optional(),
  AI_PROVIDER: z.enum(['fake', 'anthropic']).default('fake'),
  AI_MODEL: z.string().optional(),
  AI_API_KEY: z.string().min(1).optional(),
  EMBEDDING_PROVIDER: z.enum(['fake', 'openai']).optional(),
  EMBEDDING_MODEL: z.string().optional(),
  EMBEDDING_API_KEY: z.string().min(1).optional(),
  CS_COMMIT_SHA: z.string().optional(),
  VERCEL_GIT_COMMIT_SHA: z.string().optional(),
  VERCEL_ENV: z.string().optional(),
  CS_TEST_MODE: z.enum(['unit', 'e2e', 'ci']).optional(),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const input = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, v === '' ? undefined : v]));
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))].join(', ');
    throw new Error(`Invalid environment for: ${names}`);
  }
  if (parsed.data.CS_DATA_MODE === 'fake' && parsed.data.VERCEL_ENV === 'production') {
    throw new Error('CS_DATA_MODE=fake is refused in production');
  }
  // Only the optional live shadow degrades invalid DB configuration to a gap.
  // Retain established validation for every other composition, even mode=off.
  if (!(parsed.data.CS_DATA_MODE === 'live' && parsed.data.CS_CONTENT_STORE === 'db-shadow')) {
    const invalid = [
      ['SUPABASE_READ_MODEL_URL', parsed.data.SUPABASE_READ_MODEL_URL, z.string().url()],
      ['SUPABASE_READ_MODEL_SERVICE_KEY', parsed.data.SUPABASE_READ_MODEL_SERVICE_KEY, z.string().min(20)],
    ] as const;
    const names = invalid.filter(([, value, validator]) => value !== undefined && !validator.safeParse(value).success).map(([name]) => name);
    if (names.length) throw new Error(`Invalid environment for: ${names.join(', ')}`);
  }
  // Phase A alone is authorised. Read/write authority gates remain closed.
  if (parsed.data.CS_DATA_MODE === 'live' && ['db-read', 'db'].includes(parsed.data.CS_CONTENT_STORE)) {
    throw new Error('CS_CONTENT_STORE database modes are not enabled for live data');
  }
  if (parsed.data.SUPABASE_READ_MODEL_MODE !== 'off' && parsed.data.CS_CONTENT_STORE !== 'db-shadow') {
    const missing = [
      ['SUPABASE_READ_MODEL_URL', z.string().url().safeParse(parsed.data.SUPABASE_READ_MODEL_URL).success],
      ['SUPABASE_READ_MODEL_SERVICE_KEY', z.string().min(20).safeParse(parsed.data.SUPABASE_READ_MODEL_SERVICE_KEY).success],
      ['SUPABASE_READ_MODEL_SOURCE_KEY', parsed.data.SUPABASE_READ_MODEL_SOURCE_KEY],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length > 0) throw new Error(`Invalid environment for: ${missing.join(', ')}`);
  }
  cached = parsed.data;
  return cached;
}

/** Tests only. */
export function resetEnvCache(): void {
  cached = null;
}

export function commitSha(): string {
  const env = serverEnv();
  return (env.VERCEL_GIT_COMMIT_SHA ?? env.CS_COMMIT_SHA ?? 'dev').slice(0, 12);
}
