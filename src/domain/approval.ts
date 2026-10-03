import type { Gate, GateCode } from './gates';

/**
 * Gates that make approval unsafe (CS-012; shared by the server transition and
 * every approve button since CS-049, so the UI never offers an approval the
 * server will refuse). Pending review is what approval resolves, so it is not here.
 */
export const APPROVAL_BLOCKERS: ReadonlySet<GateCode> = new Set<GateCode>([
  'UNRECOGNISED_VALUE',
  'MISSING_IDENTITY',
  'COPYRIGHT_REWORK',
  'COPYRIGHT_UNCHECKED',
  'DUPLICATE_CHECK',
  'DUPLICATE_CONFIRMED',
  'DUPLICATE_UNCHECKED',
  'MISSING_COPY',
  'MISSING_SOURCE_LINK',
  'MARKDOWN_MISMATCH',
  'HOOK_MISSING',
  'REVIEW_SKIPPED',
  'VISUAL_UNDECIDED',
  'VISUAL_INVALID',
  'SCREENSHOT_REUSED',
  'SCREENSHOT_UNCERTAIN',
]);

export function approvalBlockers(blockers: readonly Gate[]): Gate[] {
  return blockers.filter((g) => APPROVAL_BLOCKERS.has(g.code));
}
