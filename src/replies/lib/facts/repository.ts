import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import { factInputSchema, factUpdateSchema } from '@/replies/lib/contracts/api';
import { AppError } from '@/replies/lib/contracts/errors';
import type { Fact } from './types';

/**
 * Pre-parse shapes derived from the canonical schemas rather than written out
 * again: a caller may omit any field that has a default (`approved`, `tags`,
 * `sensitivity`, `active`) and let `factInputSchema.parse` fill it in, which is
 * exactly how an unapproved, private candidate ends up unapproved and private
 * without a second "these are the defaults" list to keep in sync.
 */
type FactCreateInput = z.input<typeof factInputSchema>;
type FactChangesInput = z.input<typeof factUpdateSchema>['changes'];

/**
 * Owner-scoped CRUD for the `facts` table.
 *
 * Every function takes a `SupabaseClient` as an argument rather than importing
 * the server client module, so this stays callable with any client a test
 * hands it. A model or an import adapter never reaches these functions
 * directly: approval, sensitivity and source_reference are set here or by the
 * owner-facing admin route, never invented by generation code (C06).
 */

const TABLE = 'facts';

/**
 * A raw Postgres or PostgREST message is never forwarded to a caller (C07):
 * it can name a column, a constraint or another row's existence. Everything
 * that is not a version conflict collapses to `internal_error` here; the
 * distinguishing detail is kept only on `cause` for server-side logs.
 */
function toAppError(error: PostgrestError): AppError {
  return new AppError('internal_error', 'Could not complete that fact operation.', { cause: error });
}

export async function listFacts(supabase: SupabaseClient, userId: string): Promise<Fact[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw toAppError(error);
  return (data ?? []) as Fact[];
}

export async function getFact(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<Fact | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw toAppError(error);
  return (data as Fact | null) ?? null;
}

/**
 * Importing an anecdote creates an unapproved candidate: `factInputSchema`'s
 * own defaults (`approved: false`, `sensitivity: 'private_context_only'`)
 * apply here exactly as they would to a hand-typed one, because this function
 * has no separate "import" code path that could quietly skip them.
 */
export async function createFact(
  supabase: SupabaseClient,
  userId: string,
  input: FactCreateInput,
): Promise<Fact> {
  const fields = factInputSchema.parse(input);
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ ...fields, user_id: userId })
    .select()
    .single();
  if (error) throw toAppError(error);
  return data as Fact;
}

/**
 * Bumps `version` and raises `version_conflict` when `expectedVersion` is
 * stale. The version check and the write happen in one conditional update
 * rather than a read-then-write, so a second writer between the two can never
 * slip through: the `eq('version', expectedVersion)` filter is what makes the
 * update itself atomic against a concurrent change.
 *
 * `changes` is validated through `factUpdateSchema`, the same schema the API
 * route validates against, rather than a second definition of what an update
 * may contain.
 */
export async function updateFact(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  expectedVersion: number,
  changes: FactChangesInput,
): Promise<Fact> {
  const validated = factUpdateSchema.parse({ expected_version: expectedVersion, changes });

  // `factUpdateSchema`'s `changes` field is `factInputSchema.partial()`, and
  // in the zod version this project is pinned to, `.partial()` still runs
  // each field's own `.default()` for a key the caller left out entirely
  // (verified directly against the installed package, not assumed from
  // general zod behaviour). Writing `validated.changes` wholesale would
  // therefore silently reset every field the caller did not mention back to
  // its create-time default on every update: approving a fact would also
  // reset its own `sensitivity` to `private_context_only` and its `tags` to
  // `[]` in the same call, which is precisely the silent field change C06
  // forbids. So only the keys the caller actually supplied are written to
  // the database; `validated.changes` is used purely to read back the
  // type-checked value for each of those keys, never as the literal patch.
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(changes)) {
    patch[key] = (validated.changes as Record<string, unknown>)[key];
  }

  const { data, error } = await supabase
    .from(TABLE)
    .update({ ...patch, version: validated.expected_version + 1 })
    .eq('user_id', userId)
    .eq('id', id)
    .eq('version', validated.expected_version)
    .select()
    .maybeSingle();
  if (error) throw toAppError(error);
  if (!data) {
    // Zero rows matched. That means either the id does not belong to this
    // owner or another write already moved the version on; both look
    // identical from here, and C07 treats a stale version as a conflict
    // rather than guessing which one happened.
    throw new AppError(
      'version_conflict',
      'This changed somewhere else. Check the latest version before saving.',
    );
  }
  return data as Fact;
}

/**
 * Approval is the one act that can move a fact from a private candidate to
 * something eligible for generation. It is deliberately a named function
 * rather than something a general "update sensitivity/approved" caller could
 * reach by accident: nothing outside the owner-facing admin route should ever
 * call this.
 */
export async function approveFact(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  expectedVersion: number,
): Promise<Fact> {
  return updateFact(supabase, userId, id, expectedVersion, { approved: true });
}

/**
 * Disabling a fact removes it from future generation only. It never touches
 * `reply_library`: a reply that already used the fact's wording keeps its own
 * exact recorded text regardless of what happens to the fact afterwards.
 */
export async function setFactActive(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  expectedVersion: number,
  active: boolean,
): Promise<Fact> {
  return updateFact(supabase, userId, id, expectedVersion, { active });
}

