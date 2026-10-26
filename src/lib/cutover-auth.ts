import 'server-only';
import { requireCronSecret } from '@/lib/cron-auth';

export type CutoverActor = 'owner_session' | 'cron_bearer';

/** A supplied credential always takes the original bearer path. Never downgrade
 * a bad bearer to a cookie session. Browser reads use the mutation CSRF boundary
 * too, since status describes private authority and admission evidence. */
export async function requireCutoverActor(request: Request, secret: string | undefined): Promise<CutoverActor> {
  if (request.headers.has('authorization')) {
    requireCronSecret(request, secret);
    return 'cron_bearer';
  }
  const { requireMutation } = await import('@/lib/auth');
  await requireMutation(request);
  return 'owner_session';
}
