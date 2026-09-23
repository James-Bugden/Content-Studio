'use client';

import { ERROR_CODES, type ErrorCode } from '@/domain/errors';
import { buttonClass } from '../button-styles';
import { ERROR_STATE_KIND, StateView } from '../state-view';

/**
 * Failure of an optional AI action (AI-01). AI is never required: every state
 * here says the draft is unchanged and manual work continues.
 */
export function asErrorCode(code: unknown): ErrorCode {
  return typeof code === 'string' && (ERROR_CODES as readonly string[]).includes(code) ? (code as ErrorCode) : 'UNKNOWN';
}

export function AiErrorView({ code, what, onRetry }: { code: ErrorCode; what: string; onRetry?: () => void }) {
  const retry = onRetry ? (
    <button type="button" className={buttonClass()} onClick={onRetry}>
      Try again
    </button>
  ) : undefined;
  if (code === 'CONFIG_MISSING') {
    return (
      <StateView
        kind="not_configured"
        title="AI help is not configured"
        detail={`${what} is switched off. Nothing else is affected: you can still edit, save and review by hand.`}
        nextStep={null}
      />
    );
  }
  if (code === 'FORBIDDEN' || code === 'AUTH_REQUIRED') {
    return <StateView kind="forbidden" detail={`${what} needs the owner account. Nothing was changed.`} />;
  }
  if (code === 'STALE_READ') {
    return <StateView kind="conflict" title="The text changed while this ran" detail="Nothing was changed. Run it again on the current text." action={retry} nextStep={null} />;
  }
  if (code === 'GATE_BLOCKED' || code === 'NOT_FOUND' || code === 'AMBIGUOUS_MATCH') {
    return <StateView kind={ERROR_STATE_KIND[code]} title={`${what} cannot run yet`} detail="Nothing was changed. Resolve what is listed on this page first." nextStep={null} />;
  }
  return (
    <StateView
      kind={ERROR_STATE_KIND[code]}
      title={`${what} did not finish`}
      detail="No suggestions were made and nothing was changed. You can keep editing and saving by hand."
      action={retry}
    />
  );
}
