import 'server-only';
import { AppError } from '@/domain/errors';

/** Compiled typed Content schema contract, checked before every database read. */
export const CONTENT_STUDIO_SCHEMA_VERSION = 1;

export function assertContentSchemaVersion(actual: unknown): void {
  if (actual !== CONTENT_STUDIO_SCHEMA_VERSION) {
    throw new AppError('SCHEMA_DRIFT', {
      kind: 'version', expected: CONTENT_STUDIO_SCHEMA_VERSION,
      actual: typeof actual === 'number' ? actual : null,
    });
  }
}
