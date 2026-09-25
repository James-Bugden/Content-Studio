import type { z } from 'zod';
import type { resourceFieldsSchema } from '@/replies/lib/contracts/api';

/**
 * C03/C06. The shared shape of a `resources` row.
 *
 * `ResourceFields` is exactly the owner-editable surface already defined by
 * `resourceFieldsSchema` in the shared contracts, so this module never carries a
 * second, competing definition of what a resource is. `ResourceRow` adds only the
 * columns the database itself owns: identity, verification state, the monotonic
 * version and the timestamps.
 */
export type ResourceFields = z.infer<typeof resourceFieldsSchema>;

export interface ResourceRow extends ResourceFields {
  id: string;
  user_id: string;
  /** Set only by the bounded verification check (C06), never by owner input. */
  verified: boolean;
  version: number;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

