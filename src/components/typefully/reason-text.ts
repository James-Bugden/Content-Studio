import type { Platform } from '@/domain/enums';
import type { ErrorCode } from '@/domain/errors';
import type { ZhAdaptationState } from '@/domain/gates';
import type { CopyComparison, TypefullyPanelView } from '@/domain/typefully-view';

/**
 * Plain-language outcomes for Typefully mutations (CS-015/016). Every message
 * says what happened, that nothing was overwritten when that is the case, and
 * the next safe step. Reasons come from the service; nothing is inferred.
 */
export type Failure = {
  ok: false;
  code: ErrorCode | string;
  message?: string;
  details?: { reason?: string; state?: string; status?: string; comparison?: CopyComparison; reconciliation?: TypefullyPanelView };
};

export const ZH_WORDS: Record<ZhAdaptationState, string> = {
  not_required: 'not required',
  missing: 'not adapted yet',
  draft: 'a draft, not sent for review',
  awaiting_review: 'awaiting Chinese review',
  approved: 'approved and current',
  stale: 'out of date: the X copy changed after translation',
  ambiguous: 'unclear: several Threads rows claim the X post',
};

export function reasonText(f: Failure, platform: Platform | null): string {
  const r = f.details?.reason;
  if (f.code === 'FORBIDDEN') return 'Only the owner can change Typefully drafts. Nothing was changed.';
  if (f.code === 'AUTH_REQUIRED') return 'You were signed out. Nothing was changed. Sign in again, then retry.';
  if (f.code === 'STALE_READ') return 'The Sheet row changed after this page loaded. Nothing was changed. The latest version is shown now; check it and try again.';
  if (r === 'zh_adaptation_not_approved') {
    const state = (f.details?.state ?? 'missing') as ZhAdaptationState;
    return `Not created: the Chinese adaptation is ${ZH_WORDS[state] ?? state}. Approve a current adaptation first.`;
  }
  if (r === 'not_published') return `Typefully has not published this yet (status ${f.details?.status ?? 'unknown'}). Nothing was written.`;
  if (r === 'not_linked') return 'This row has no Typefully Draft ID, so there is nothing to sync. Link it in the Typefully panel first.';
  if (r === 'sheet_final_edited' || r === 'no_sync_baseline') return 'Final Content differs from Typefully and may have been edited in the Sheet. Nothing was overwritten. Compare both in the Typefully panel and choose there.';
  if (r === 'stage_not_ready') return 'Not created: Content Stage is not Ready.';
  if (r === 'missing_copy') return `Not created: the ${platform === 'Threads' ? 'Chinese Content' : 'Content'} cell is empty.`;
  if (r === 'no_planned_date') return 'Not created: this row has no planned date and time.';
  if (r === 'existing_match' || r === 'candidates_exist') return 'Not created: a Typefully draft already matches this slot. Choose it below instead.';
  if (r === 'already_linked') return 'This row is already linked to a different Typefully draft. Nothing was changed.';
  if (r === 'linked_elsewhere') return 'That draft is already linked to another Schedule row. Nothing was changed.';
  if (r === 'platform_mismatch') return 'That draft is not for this row’s platform. Nothing was changed.';
  if (r === 'multi_platform_draft') return 'That draft posts to more than one platform. Split it in Typefully, then link it.';
  if (r === 'create_outcome_unknown') return 'Typefully did not confirm the draft, so it may or may not exist. Try again: the retry looks for it first and will not make a second draft.';
  if (r === 'published_at_mismatch') return 'Published At in the Sheet differs from Typefully. Nothing was changed; check which is right and fix the Sheet.';
  if (r === 'post_link_mismatch') return 'Post Link in the Sheet differs from Typefully. Nothing was changed; check which is right and fix the Sheet.';
  if (r === 'status_regressed') return 'The Sheet says Published but Typefully does not. Nothing was changed; check the post in Typefully.';
  if (r === 'already_published') return 'Typefully has already published this post, so its text cannot be replaced. Nothing was changed.';
  if (r === 'sheet_write_failed') return 'Typefully was updated but the Sheet was not. Try again: the retry finishes the Sheet step without repeating Typefully.';
  if (f.code === 'CONFIG_MISSING') return 'Typefully is not configured. Review and scheduling keep working.';
  if (f.code === 'RATE_LIMITED') return 'Typefully asked us to slow down. Nothing was sent twice. Wait a minute, then try again.';
  if (f.code === 'PROVIDER_UNAVAILABLE') return 'Typefully did not respond. Nothing is confirmed as changed. Try again.';
  return f.message ?? 'Nothing is confirmed as changed. Try again.';
}

