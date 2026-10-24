import 'server-only';
import type { Capability } from '@/domain/capability';
import { serverEnv } from '@/lib/env';

/** A comparison-only DB must never claim writable capability. */
export function fakeContentDatabaseCapability(store: ReturnType<typeof serverEnv>['CS_CONTENT_STORE']): Capability {
  return { provider: 'db', mode: 'fake', state: store === 'sheet' ? 'not_configured' : store === 'db-shadow' ? 'read_only' : 'ready',
    ...(store !== 'db' ? { detail: 'Derived database copy; Sheet remains authoritative' } : {}) };
}

/** Capability from configuration presence only. Content-free by construction (OBS-01). */
export function capabilities(): Capability[] {
  const env = serverEnv();
  const includeDb = env.CS_CONTENT_STORE === 'db' || env.CS_CONTENT_STORE === 'db-read';
  const active = (caps: Capability[]) => caps.filter(c => c.provider !== 'db' || includeDb);
  if (env.CS_DATA_MODE === 'fake') {
    return active((['auth', 'sheet', 'db', 'drive', 'typefully', 'ai'] as const).map((provider) => provider === 'db'
      ? fakeContentDatabaseCapability(env.CS_CONTENT_STORE) : { provider, state: 'ready', mode: 'fake' }));
  }
  const googleCreds = Boolean(env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
  const google = (hasTarget: boolean): Capability['state'] =>
    !googleCreds || !hasTarget ? 'not_configured' : env.GOOGLE_WRITE_ENABLED === 'true' ? 'ready' : 'read_only';
  return active([
    {
      provider: 'auth',
      mode: 'live',
      state: env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET && env.AUTH_SECRET && env.CS_OWNER_GOOGLE_SUB ? 'ready' : 'not_configured',
    },
    { provider: 'sheet', mode: 'live', state: google(Boolean(env.CS_SHEET_ID)) },
    // Keep this authority label when live db-read is separately wired/enabled.
    { provider: 'db', mode: 'live', state: 'not_configured', detail: env.CS_CONTENT_STORE === 'db-read'
      ? 'Derived database copy; Sheet remains authoritative; cutover is not enabled' : 'Content database cutover is not enabled' },
    { provider: 'drive', mode: 'live', state: google(true) },
    { provider: 'typefully', mode: 'live', state: env.TYPEFULLY_API_KEY && env.TYPEFULLY_SOCIAL_SET_ID ? 'ready' : 'not_configured' },
    {
      provider: 'ai',
      mode: 'live',
      state: env.AI_PROVIDER === 'anthropic' && env.AI_API_KEY ? 'ready' : 'not_configured',
      ...(env.AI_PROVIDER === 'anthropic' && env.AI_API_KEY ? {} : { detail: 'AI proposals off; manual review still works' }),
    },
  ]);
}
