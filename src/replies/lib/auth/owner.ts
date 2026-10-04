import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getActor } from '@/lib/auth';
import { AppError } from '@/replies/lib/contracts/errors';
import { serverConfig } from '@/replies/lib/config/env';
import { createReplyServerClient } from '@/replies/lib/supabase/server';

export interface OwnerSession {
  userId: string;
  supabase: SupabaseClient;
}

/** The existing Content Studio Google owner session is the one browser login. */
export async function getOwnerSession(): Promise<OwnerSession | null> {
  const actor = await getActor();
  if (!actor || actor.role !== 'owner') return null;
  if (!serverConfig().database.configured) return null;
  const supabase = createReplyServerClient();
  const { data, error } = await supabase.rpc('server_owner_id');
  if (error || typeof data !== 'string') {
    throw new AppError('not_configured', 'The reply database owner is not configured yet.');
  }
  return { userId: data, supabase };
}

/**
 * Why there is no owner session, so the page can say the true thing (CS-054).
 * A signed-in owner with no reply database configured used to be told to sign
 * in, which sent them in a loop: signing in again cannot fix a missing setting.
 */
export type NoSessionReason = 'signed_out' | 'not_owner' | 'not_configured';

export async function noSessionReason(): Promise<NoSessionReason> {
  const actor = await getActor();
  if (!actor) return 'signed_out';
  if (actor.role !== 'owner') return 'not_owner';
  return serverConfig().database.configured ? 'signed_out' : 'not_configured';
}

export async function requireOwner(): Promise<OwnerSession> {
  const session = await getOwnerSession();
  if (!session) throw new AppError('unauthenticated', 'Sign in to continue.');
  return session;
}
