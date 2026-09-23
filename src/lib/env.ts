import 'server-only';
import { z } from 'zod';

/**
 * Server environment (CS-001). Parsed once; errors name variables, never values.
 * Values are never logged, returned by health output or sent to the browser.
 */
const schema = z.object({
  CS_DATA_MODE: z.enum(['fake', 'live']).default('fake'),
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
  AI_PROVIDER: z.enum(['fake', 'anthropic']).default('fake'),
  AI_MODEL: z.string().optional(),
  AI_API_KEY: z.string().min(1).optional(),
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
