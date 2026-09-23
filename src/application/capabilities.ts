import 'server-only';
import type { Capability } from '@/domain/capability';
import { serverEnv } from '@/lib/env';

/** Capability from configuration presence only. Content-free by construction (OBS-01). */
export function capabilities(): Capability[] {
  const env = serverEnv();
  if (env.CS_DATA_MODE === 'fake') {
    return (['auth', 'sheet', 'drive', 'typefully', 'ai'] as const).map((provider) => ({ provider, state: 'ready', mode: 'fake' }));
  }
  const googleCreds = Boolean(env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
  const google = (hasTarget: boolean): Capability['state'] =>
    !googleCreds || !hasTarget ? 'not_configured' : env.GOOGLE_WRITE_ENABLED === 'true' ? 'ready' : 'read_only';
  return [
    {
      provider: 'auth',
      mode: 'live',
      state: env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET && env.AUTH_SECRET && env.CS_OWNER_GOOGLE_SUB ? 'ready' : 'not_configured',
    },
    { provider: 'sheet', mode: 'live', state: google(Boolean(env.CS_SHEET_ID)) },
    { provider: 'drive', mode: 'live', state: google(true) },
    { provider: 'typefully', mode: 'live', state: env.TYPEFULLY_API_KEY && env.TYPEFULLY_SOCIAL_SET_ID ? 'ready' : 'not_configured' },
    {
      provider: 'ai',
      mode: env.AI_PROVIDER === 'fake' ? 'fake' : 'live',
      state: env.AI_PROVIDER === 'fake' || env.AI_API_KEY ? 'ready' : 'not_configured',
    },
  ];
}
