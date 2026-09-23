import { z } from 'zod';
import type { ErrorCode } from './errors';

/**
 * Mutation envelope (MASTER-SPEC section 7).
 *
 * `{operation_id, actor, target, expected_revision, exact_patch}`. The same
 * operation with the same patch replays safely; the same operation with a
 * different patch is a conflict.
 */
export const operationIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,80}$/, 'operation id must be 8-80 url-safe characters');

export const libraryIdSchema = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, 'invalid Library ID');
export const contentIdSchema = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, 'invalid Content ID');
export const revisionSchema = z.string().regex(/^[0-9a-f]{16}$/, 'invalid revision');

export type Actor = { sub: string; role: 'owner' | 'viewer' };

export type MutationEnvelope<TTarget, TPatch> = {
  operationId: string;
  actor: Actor;
  target: TTarget;
  expectedRevision: string;
  patch: TPatch;
};

export type StepResult = {
  step: string;
  status: 'done' | 'skipped_already_applied' | 'failed' | 'pending';
  provider: 'sheet' | 'drive' | 'typefully' | 'ai';
  /** Provider revision/fingerprint after the step, when known. */
  revision?: string;
  errorCode?: ErrorCode;
};

export type MutationResult<T> =
  | { ok: true; operationId: string; replayed: boolean; value: T; steps: StepResult[] }
  | { ok: false; operationId: string; code: ErrorCode; steps: StepResult[]; details?: Record<string, unknown> };
