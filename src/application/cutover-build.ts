import 'server-only';
import { z } from 'zod';
import { AppError } from '@/domain/errors';

// Exact lowercase SHA, without coercion, case folding or whitespace trimming.
export const expectedBuildSchema = z.string().regex(/^[a-f0-9]{40}$/);

/** No normalization: the reviewed SHA must equal this request's server build. */
export function assertExpectedCutoverBuild(expectedBuild: unknown, build: string) {
  if (!expectedBuildSchema.safeParse(expectedBuild).success) throw new AppError('GATE_BLOCKED', { reason: 'cutover_expected_build_invalid' });
  if (expectedBuild !== build) throw new AppError('CONFLICT', { reason: 'cutover_build_mismatch' });
}
