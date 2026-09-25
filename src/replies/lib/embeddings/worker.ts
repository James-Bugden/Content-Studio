import { EMBEDDING, embeddingBackoffSeconds } from '@/replies/lib/contracts/limits';
import type { SqlRunner } from '@/replies/lib/retrieval/runner';
import { vectorSearchAvailable } from '@/replies/lib/retrieval/semantic';
import type { Embedder } from './provider';

/**
 * The embedding outbox worker (C05, C09).
 *
 * The contract it exists to keep is that recording a reply never waits on a
 * model API. The save writes a lexical search row and a job in one transaction;
 * this worker turns jobs into vectors afterwards, and every way it can fail
 * leaves the reply exactly as findable as it was the moment it was saved.
 *
 * Three properties do the work:
 *
 *   * a **lease**, so two workers cannot spend two API calls on one job;
 *   * a **text hash guard**, so a job queued before a correction cannot write its
 *     stale vector over the corrected row. The guard is part of the UPDATE's
 *     WHERE clause rather than a read-then-write check, because a correction can
 *     land between the read and the write;
 *   * a **bounded attempt count**, after which the job is `dead` and stays
 *     retryable by an explicit operator action rather than looping forever.
 *
 * The worker is handed its runner, its embedder and its clock. It opens nothing
 * and schedules nothing, so a test can run it, advance time and run it again.
 */

export interface EmbeddingJob {
  id: string;
  user_id: string;
  entity_kind: string;
  entity_id: string;
  text_hash: string;
  model: string;
  attempts: number;
}

export interface WorkerOptions {
  /** Explicit owner scoping for the administrative connection the worker uses. */
  ownerId?: string;
  batchSize?: number;
  leaseSeconds?: number;
  /** Injected so retry backoff can be observed without waiting for it. */
  now?: () => Date;
  /** Stamped beside the vector so a re-embedding campaign is identifiable. */
  embeddingVersion?: number;
}

export interface WorkerReport {
  claimed: number;
  /** Vectors written. */
  applied: number;
  /** Jobs whose text changed underneath them. Retired without applying. */
  superseded: number;
  /** Released untouched because no provider is configured. Not a failure. */
  released: number;
  retried: number;
  dead: number;
  /** Provider answered, but this database has no vector column to store it in. */
  storageUnavailable: number;
}

const DEFAULT_BATCH_SIZE = 10;

/**
 * Whether this process is allowed to embed anything, and for whom.
 *
 * A background job has no session, so `auth.uid()` is null and row level
 * security is not the boundary. C01 is explicit that an administrative
 * credential does its own owner scoping instead, which means the owner has to be
 * established before a single row is claimed rather than inferred from whatever
 * the query happens to return.
 */
export type OwnerScope =
  | { ok: true; ownerId: string }
  | { ok: false; reason: 'no_enabled_owner' | 'several_enabled_owners' | 'owner_lookup_failed' };

/**
 * Reads the single enabled owner from the private owner table.
 *
 * The table is the only place the owner's id exists (C01): not in this
 * repository, not in an environment variable a stale deployment could still be
 * holding, and not in an editable profile row. Anything other than exactly one
 * enabled row is refused rather than resolved to a guess.
 */
export async function resolveOwnerScope(runner: SqlRunner): Promise<OwnerScope> {
  let rows: { user_id: string }[];
  try {
    ({ rows } = await runner.query<{ user_id: string }>(
      `select o.user_id::text as user_id from private.app_owner o where o.enabled`,
    ));
  } catch {
    // The message can name a schema and a role, and this process logs to a
    // terminal the owner may well paste somewhere. A code is enough.
    return { ok: false, reason: 'owner_lookup_failed' };
  }

  const first = rows[0];
  if (!first) return { ok: false, reason: 'no_enabled_owner' };
  if (rows.length > 1) return { ok: false, reason: 'several_enabled_owners' };
  return { ok: true, ownerId: first.user_id };
}

export type OwnerScopedPass =
  | { status: 'ran'; ownerId: string; report: WorkerReport }
  | { status: 'refused'; reason: Extract<OwnerScope, { ok: false }>['reason'] };

/**
 * One worker pass, scoped to the enabled owner, or no pass at all.
 *
 * This is the entry point a scheduled worker uses, and it exists because calling
 * `processEmbeddingJobs` with no options over an RLS-bypassing administrative
 * connection claims and embeds *every* user's rows, sending one account's
 * private writing to an embedding provider on another account's behalf. Refusing
 * is the only safe answer to "I cannot tell whose rows these are": an embedding
 * is never so urgent that it is worth guessing.
 */
export async function runOwnerScopedPass(
  runner: SqlRunner,
  embedder: Embedder,
  options: Omit<WorkerOptions, 'ownerId'> = {},
): Promise<OwnerScopedPass> {
  const scope = await resolveOwnerScope(runner);
  if (!scope.ok) return { status: 'refused', reason: scope.reason };

  const report = await processEmbeddingJobs(runner, embedder, {
    ...options,
    ownerId: scope.ownerId,
  });
  return { status: 'ran', ownerId: scope.ownerId, report };
}

/**
 * Claims due jobs and holds them for `leaseSeconds`.
 *
 * `for update skip locked` handles two workers racing inside the same instant;
 * the lease handles the slower and more likely case of one worker still holding
 * a job when the next scheduled run starts. Attempts increment at claim time, so
 * a worker that crashes mid-job still consumes an attempt and a poisoned job
 * cannot be retried forever by killing the process.
 */
export async function claimEmbeddingJobs(
  runner: SqlRunner,
  options: WorkerOptions = {},
): Promise<EmbeddingJob[]> {
  const now = (options.now ?? (() => new Date()))().toISOString();
  const leaseSeconds = options.leaseSeconds ?? EMBEDDING.leaseSeconds;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

  const params: unknown[] = [now, leaseSeconds, batchSize];
  let ownerFilter = '';
  if (options.ownerId !== undefined) {
    params.push(options.ownerId);
    ownerFilter = `and c.user_id = $${params.length}::uuid`;
  }

  const { rows } = await runner.query<EmbeddingJob>(
    `update public.embedding_jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         lease_until = $1::timestamptz + make_interval(secs => $2::double precision)
     where j.id in (
       select c.id
       from public.embedding_jobs c
       where c.status in ('pending', 'retry', 'running')
         and c.next_attempt_at <= $1::timestamptz
         and (c.lease_until is null or c.lease_until <= $1::timestamptz)
         ${ownerFilter}
       order by c.next_attempt_at, c.created_at
       limit $3
       for update skip locked
     )
     returning j.id::text as id,
               j.user_id::text as user_id,
               j.entity_kind::text as entity_kind,
               j.entity_id::text as entity_id,
               j.text_hash as text_hash,
               j.model as model,
               j.attempts as attempts`,
    params,
  );
  return rows;
}

export async function processEmbeddingJobs(
  runner: SqlRunner,
  embedder: Embedder,
  options: WorkerOptions = {},
): Promise<WorkerReport> {
  const clock = options.now ?? (() => new Date());
  const report: WorkerReport = {
    claimed: 0,
    applied: 0,
    superseded: 0,
    released: 0,
    retried: 0,
    dead: 0,
    storageUnavailable: 0,
  };

  const jobs = await claimEmbeddingJobs(runner, options);
  report.claimed = jobs.length;
  if (jobs.length === 0) return report;

  // Read the indexed text and its current hash together. A job whose row has
  // already moved on is retired here rather than costing an API call.
  const live: { job: EmbeddingJob; text: string }[] = [];
  for (const job of jobs) {
    const document = await currentDocument(runner, job);
    if (!document || document.text_hash !== job.text_hash) {
      await retireJob(runner, job.id, 'superseded_by_newer_text');
      report.superseded += 1;
      continue;
    }
    live.push({ job, text: document.search_text });
  }
  if (live.length === 0) return report;

  const result = await embedder.embed(live.map((entry) => entry.text));

  if (result.status === 'not_configured') {
    // No provider is a supported state, so the attempt is given back. Consuming
    // it would march a perfectly good job towards `dead` for a reason that has
    // nothing to do with the job.
    for (const entry of live) await releaseJob(runner, entry.job.id);
    report.released = live.length;
    return report;
  }

  if (result.status === 'failed') {
    for (const entry of live) {
      const outcome = await failJob(runner, entry.job, clock(), result.code);
      if (outcome === 'dead') report.dead += 1;
      else report.retried += 1;
    }
    return report;
  }

  const canStoreVectors = await vectorSearchAvailable(runner);
  const version = options.embeddingVersion ?? 1;

  for (const [index, entry] of live.entries()) {
    const vector = result.vectors[index];
    if (!vector) {
      const outcome = await failJob(runner, entry.job, clock(), 'provider_invalid_response');
      if (outcome === 'dead') report.dead += 1;
      else report.retried += 1;
      continue;
    }

    if (!canStoreVectors) {
      // The provider answered but this database has no vector column. Recording
      // an `embedded_at` here would claim an index entry that does not exist.
      await retireJob(runner, entry.job.id, 'vector_storage_unavailable');
      report.storageUnavailable += 1;
      continue;
    }

    const stored = await applyVector(runner, entry.job, vector, result.model, version, clock());
    if (stored) {
      await retireJob(runner, entry.job.id, null);
      report.applied += 1;
    } else {
      await retireJob(runner, entry.job.id, 'superseded_by_newer_text');
      report.superseded += 1;
    }
  }

  return report;
}

async function currentDocument(
  runner: SqlRunner,
  job: EmbeddingJob,
): Promise<{ text_hash: string; search_text: string } | null> {
  const { rows } = await runner.query<{ text_hash: string; search_text: string }>(
    `select text_hash, search_text
     from public.search_documents
     where user_id = $1::uuid and entity_kind::text = $2 and entity_id = $3::uuid`,
    [job.user_id, job.entity_kind, job.entity_id],
  );
  return rows[0] ?? null;
}

/**
 * Writes the vector only while the indexed text still hashes to what this job
 * was queued for. The guard is in the WHERE clause, so a correction committed a
 * millisecond ago wins without any coordination between the two writers.
 */
async function applyVector(
  runner: SqlRunner,
  job: EmbeddingJob,
  vector: readonly number[],
  model: string,
  version: number,
  now: Date,
): Promise<boolean> {
  const { rows } = await runner.query<{ id: string }>(
    `update public.search_documents
     set embedding = $1::extensions.vector,
         embedding_model = $2,
         embedding_version = $3,
         embedded_at = $4::timestamptz
     where user_id = $5::uuid
       and entity_kind::text = $6
       and entity_id = $7::uuid
       and text_hash = $8
     returning id::text as id`,
    [
      `[${vector.join(',')}]`,
      model,
      version,
      now.toISOString(),
      job.user_id,
      job.entity_kind,
      job.entity_id,
      job.text_hash,
    ],
  );
  return rows.length > 0;
}

/** Finishes a job without a further attempt. `reason` is diagnostics, not status. */
async function retireJob(runner: SqlRunner, id: string, reason: string | null): Promise<void> {
  await runner.query(
    `update public.embedding_jobs
     set status = 'done', lease_until = null, last_error_code = $2
     where id = $1::uuid`,
    [id, reason],
  );
}

/** Hands the job back untouched. No error code: nothing went wrong. */
async function releaseJob(runner: SqlRunner, id: string): Promise<void> {
  await runner.query(
    `update public.embedding_jobs
     set status = 'pending',
         lease_until = null,
         attempts = greatest(attempts - 1, 0),
         last_error_code = null
     where id = $1::uuid`,
    [id],
  );
}

/**
 * Schedules the next attempt, or gives up.
 *
 * Giving up means `dead`, which keeps the row, keeps its error code and keeps
 * `next_attempt_at` set, so an operator can requeue it. It never means deleting
 * the search document: the reply stays lexically findable either way, which is
 * the property that makes an embedding outage survivable.
 */
async function failJob(
  runner: SqlRunner,
  job: EmbeddingJob,
  now: Date,
  code: string,
): Promise<'retry' | 'dead'> {
  const exhausted = job.attempts >= EMBEDDING.maxAttempts;
  const delay = embeddingBackoffSeconds(job.attempts);
  await runner.query(
    `update public.embedding_jobs
     set status = $2::public.embedding_job_status,
         lease_until = null,
         next_attempt_at = $3::timestamptz + make_interval(secs => $4::double precision),
         last_error_code = $5
     where id = $1::uuid`,
    [job.id, exhausted ? 'dead' : 'retry', now.toISOString(), delay, code],
  );
  return exhausted ? 'dead' : 'retry';
}

