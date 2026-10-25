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
  const build = env.VERCEL_GIT_COMMIT_SHA ?? env.CS_COMMIT_SHA;
  return json({ ok: true, commit: build && /^[a-f0-9]{40}$/.test(build) ? build : commitSha(),
    ...(env.VERCEL_DEPLOYMENT_ID ? { deploymentId: env.VERCEL_DEPLOYMENT_ID } : {}), mode: env.CS_DATA_MODE, capabilities: capabilities() });
}
