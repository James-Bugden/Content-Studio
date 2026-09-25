import type { Platform } from '@/replies/lib/contracts/vocabulary';
import type { ResourceRow } from './types';

/**
 * C06. A resource may be offered for automatic insertion only when all three
 * gates hold at once: it is turned on, it has passed the bounded verification
 * check, and the current platform is one the owner actually allowed it for.
 *
 * Pure and synchronous on purpose, so the generation guard, the workspace UI and
 * a direct-API defence check all run the identical rule rather than three
 * implementations that can quietly drift apart.
 */
export function isInsertable(
  resource: Pick<ResourceRow, 'active' | 'verified' | 'allowed_platforms'>,
  platform: Platform,
): boolean {
  return resource.active && resource.verified && resource.allowed_platforms.includes(platform);
}

