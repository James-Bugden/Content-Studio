import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { AppError } from '@/replies/lib/contracts/errors';
import { serverConfig } from '@/replies/lib/config/env';

/**
 * Server-only Reply client for the combined app.
 *
 * Browser authentication remains Auth.js Google OIDC. The service credential is
 * never exposed and every HTTP route is wrapped by ownerRoute before this client
 * can be created. The database returns its single enabled owner only through a
 * service-role-only RPC; the browser never receives that identifier.
 */
export function createReplyServerClient() {
  const database = serverConfig().database;
  if (!database.configured || !database.url || !database.serviceKey) {
    throw new AppError('not_configured', 'The reply database is not configured yet.');
  }
  return createClient(database.url, database.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
