import 'server-only';
import { CONTENT_STUDIO_SCHEMA_VERSION } from '@/integrations/supabase/content-schema';

/** Bump for incompatible authority/export/rollback semantics, not each build. */
export const CUTOVER_CONTRACT = `schema-${CONTENT_STUDIO_SCHEMA_VERSION}:cutover-1`;
