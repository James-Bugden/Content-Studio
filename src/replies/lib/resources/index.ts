/**
 * SR-005. Public surface of the resource registry: resolution, eligibility, CTA
 * text and owner-scoped CRUD. Everything else in this directory is an
 * implementation detail other modules should not reach into directly.
 */

export {
  resolveResourceUrl,
  type ResolveResourceUrlOptions,
  type ResolvedResourceUrl,
  type ResolvedLocale,
  type ResourceUrlReason,
} from './resolve';

export { isInsertable } from './eligibility';

export { buildCta } from './cta';

export {
  listResources,
  getResource,
  createResource,
  updateResource,
  disableResource,
  planVersionedUpdate,
  type VersionedUpdatePlan,
} from './repository';

export type { ResourceRow, ResourceFields } from './types';

