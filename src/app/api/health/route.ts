import { json } from '@/lib/http';
import { commitSha, serverEnv } from '@/lib/env';
import { capabilities } from '@/application/capabilities';

export const dynamic = 'force-dynamic';

/**
 * Health (OBS-01): commit and capability states only. Never content, tokens,
 * account identifiers, Sheet/Drive ids or names.
 */
export async function GET() {
  const env = serverEnv();
  return json({ ok: true, commit: commitSha(), mode: env.CS_DATA_MODE, capabilities: capabilities() });
}
