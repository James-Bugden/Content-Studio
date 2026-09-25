import type { SupabaseClient } from '@supabase/supabase-js';
import {
  resourceInputSchema,
  resourceFieldsSchema,
  type ResourceInput,
} from '@/replies/lib/contracts/api';
import { AppError, GENERIC_MESSAGE, codeForSqlState } from '@/replies/lib/contracts/errors';
import type { ResourceRow } from './types';

/**
 * C03/C06/C07. Owner-scoped CRUD for the `resources` table.
 *
 * Every function takes the caller's already-authenticated `SupabaseClient`
 * rather than importing `@/replies/lib/supabase/server` itself, so this module has no
 * dependency on `next/headers` or a live request and stays directly testable.
 * RLS is still the real boundary (C01); the explicit `user_id` filters below are
 * a second, redundant check, not a substitute for it.
 */

interface PostgrestErrorLike {
  code?: string | null;
  message?: string;
}

function mapPostgrestError(error: PostgrestErrorLike): AppError {
  const code = codeForSqlState(error.code ?? undefined);
  return new AppError(code, GENERIC_MESSAGE[code], { cause: error });
}

export async function listResources(
  supabase: SupabaseClient,
  userId: string,
): Promise<ResourceRow[]> {
  const { data, error } = await supabase
    .from('resources')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw mapPostgrestError(error);
  return (data ?? []) as ResourceRow[];
}

export async function getResource(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<ResourceRow | null> {
  const { data, error } = await supabase
    .from('resources')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw mapPostgrestError(error);
  return (data as ResourceRow | null) ?? null;
}

export async function createResource(
  supabase: SupabaseClient,
  userId: string,
  input: ResourceInput,
): Promise<ResourceRow> {
  const validated = resourceInputSchema.parse(input);
  const { data, error } = await supabase
    .from('resources')
    .insert({ ...validated, user_id: userId })
    .select()
    .single();
  if (error) throw mapPostgrestError(error);
  return data as ResourceRow;
}

/**
 * The version-conflict decision on its own, with no I/O, so it can be proven
 * correct without a database: same version advances by exactly one, anything
 * else is a conflict and must change nothing.
 */
export type VersionedUpdatePlan =
  | { outcome: 'apply'; nextVersion: number }
  | { outcome: 'conflict' };

export function planVersionedUpdate(currentVersion: number, expectedVersion: number): VersionedUpdatePlan {
  if (currentVersion !== expectedVersion) return { outcome: 'conflict' };
  return { outcome: 'apply', nextVersion: currentVersion + 1 };
}

/**
 * Updates a resource, bumping `version`, only when `expectedVersion` still
 * matches the stored row. The `.eq('version', expectedVersion)` in the same
 * query as the write is what makes this safe under concurrent requests: there
 * is no separate read-then-write gap for a second caller to land in.
 */
export async function updateResource(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  expectedVersion: number,
  changes: Partial<ResourceInput>,
): Promise<ResourceRow> {
  const validated = resourceFieldsSchema.partial().parse(changes);

  const current = await getResource(supabase, userId, id);
  if (!current) throw new AppError('not_found', GENERIC_MESSAGE.not_found);

  const plan = planVersionedUpdate(current.version, expectedVersion);
  if (plan.outcome === 'conflict') {
    throw new AppError('version_conflict', GENERIC_MESSAGE.version_conflict);
  }

  // The read above can still be beaten by another write before this query runs.
  // `.eq('version', expectedVersion)` makes the update itself conditional, so
  // that second race lands here rather than silently overwriting a newer row.
  const { data, error } = await supabase
    .from('resources')
    .update({ ...validated, version: plan.nextVersion })
    .eq('id', id)
    .eq('user_id', userId)
    .eq('version', expectedVersion)
    .select()
    .maybeSingle();
  if (error) throw mapPostgrestError(error);
  if (data) return data as ResourceRow;

  throw new AppError('version_conflict', GENERIC_MESSAGE.version_conflict);
}

/**
 * Soft-disables a resource. Disabling removes it from the insertable set the
 * moment `isInsertable` next reads `active`, without touching any historical
 * reply, snapshot or cached recommendation already recorded (C06).
 */
export async function disableResource(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<ResourceRow> {
  const { data, error } = await supabase
    .from('resources')
    .update({ active: false })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .maybeSingle();
  if (error) throw mapPostgrestError(error);
  if (!data) throw new AppError('not_found', GENERIC_MESSAGE.not_found);
  return data as ResourceRow;
}

