import 'server-only';
import { AppError } from '@/domain/errors';

/** DB-1 contract only. Runtime repository wiring belongs to DB-2/DB-3. */
export const CONTENT_STUDIO_SCHEMA_VERSION = 1;

export function assertContentSchemaVersion(actual: unknown): void {
  if (actual !== CONTENT_STUDIO_SCHEMA_VERSION) {
    throw new AppError('SCHEMA_DRIFT', {
      kind: 'version', expected: CONTENT_STUDIO_SCHEMA_VERSION,
      actual: typeof actual === 'number' ? actual : null,
    });
  }
}
