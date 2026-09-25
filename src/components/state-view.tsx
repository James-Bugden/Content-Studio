import { ERROR_CATALOGUE, type ErrorCode, type RecoveryAction } from '@/domain/errors';

/**
 * Whole-region states (CS-006, UX-02).
 *
 * Loading, empty, no-match, not-configured, blocked, conflict, rate-limited,
 * provider-error, partial-failure and forbidden must never look alike: each has
 * its own glyph, frame and default copy. Neutral states are polite (role=status);
 * problems are announced at once (role=alert). Default copy always says what is
 * safe and the next recovery step, per MASTER-SPEC section 7.
 */
export const STATE_KINDS = [
  'loading',
  'empty',
  'no_match',
  'not_configured',
  'blocked',
  'conflict',
  'rate_limited',
  'provider_error',
  'partial_failure',
  'forbidden',
] as const;
export type StateKind = (typeof STATE_KINDS)[number];

type KindLook = {
  role: 'status' | 'alert';
  glyph: string;
  /** Visible category word, so the kind is never carried by colour. */
  label: string;
  frame: string;
  mark: string;
  title: string;
  detail: string;
  nextStep?: string;
};

export const STATE_LOOK: Record<StateKind, KindLook> = {
  loading: {
    role: 'status',
    glyph: '',
    label: 'Loading',
    frame: 'border border-line bg-card',
    mark: 'border-line text-ink-soft',
    title: 'Loading the latest version',
    detail: 'Reading from the Sheet. Nothing is changed while this loads.',
  },
  empty: {
    role: 'status',
    glyph: '○',
    label: 'Empty',
    frame: 'border border-dashed border-line bg-card',
    mark: 'border-line text-ink-soft',
    title: 'Nothing here yet',
    detail: 'There are no items in this view, so nothing needs your attention.',
  },
  no_match: {
    role: 'status',
    glyph: '∅',
    label: 'No match',
    frame: 'border border-dashed border-line bg-card',
    mark: 'border-line text-ink-soft',
    title: 'No items match these filters',
    detail: 'Your items are safe; the filters are hiding them.',
    nextStep: 'Clear the filters to see everything.',
  },
  not_configured: {
    role: 'alert',
    glyph: 'i',
    label: 'Not configured',
    frame: 'border border-attention-line bg-attention-soft border-l-4',
    mark: 'border-attention-line text-attention',
    title: 'This integration is not configured yet',
    detail: 'Actions that need it are switched off. Reading and manual review still work.',
    nextStep: 'Add the missing configuration, then reload.',
  },
  blocked: {
    role: 'alert',
    glyph: '✕',
    label: 'Blocked',
    frame: 'border-2 border-block bg-block-soft',
    mark: 'border-block text-block rounded-sm',
    title: 'A release gate is blocking this',
    detail: 'Nothing was changed.',
    nextStep: 'Resolve the listed blocker, then try again.',
  },
  conflict: {
    role: 'alert',
    glyph: '⇄',
    label: 'Conflict',
    frame: 'border border-attention-line bg-attention-soft border-l-4',
    mark: 'border-attention-line text-attention',
    title: 'This changed somewhere else',
    detail: 'Both versions are kept. Nothing was overwritten.',
    nextStep: 'Compare the versions and choose what to keep.',
  },
  rate_limited: {
    role: 'alert',
    glyph: '⧖',
    label: 'Rate limited',
    frame: 'border border-attention-line bg-attention-soft border-dashed',
    mark: 'border-attention-line text-attention',
    title: 'The provider asked us to slow down',
    detail: 'Nothing was lost and nothing was sent twice.',
    nextStep: 'Wait a minute, then try again.',
  },
  provider_error: {
    role: 'alert',
    glyph: '✕',
    label: 'Provider error',
    frame: 'border border-block bg-block-soft border-l-4',
    mark: 'border-block text-block',
    title: 'A provider is not responding',
    detail: 'Nothing was confirmed as written. Manual review still works.',
    nextStep: 'Try again shortly.',
  },
  partial_failure: {
    role: 'alert',
    glyph: '◐',
    label: 'Partly done',
    frame: 'border border-block bg-block-soft border-l-4',
    mark: 'border-block text-block',
    title: 'Some steps did not finish',
    detail: 'Completed steps are kept and will not run twice.',
    nextStep: 'Retry the remaining steps.',
  },
  forbidden: {
    role: 'alert',
    glyph: '⊘',
    label: 'Not allowed',
    frame: 'border border-line bg-card border-l-4 border-l-ink',
    mark: 'border-ink text-ink',
    title: 'This account cannot do that',
    detail: 'Nothing was changed.',
    nextStep: 'Sign in with the owner account to continue.',
  },
};

export type StateViewProps = {
  kind: StateKind;
  title?: string;
  detail?: React.ReactNode;
  /** Overrides the default recovery step; pass null to hide it. */
  nextStep?: string | null;
  action?: React.ReactNode;
};

export function StateView({ kind, title, detail, nextStep, action }: StateViewProps) {
  const look = STATE_LOOK[kind];
  const step = nextStep === null ? null : (nextStep ?? look.nextStep ?? null);
  return (
    <div
      role={look.role}
      aria-busy={kind === 'loading' ? true : undefined}
      data-state={kind}
      className={`flex items-start gap-4 rounded-lg p-5 ${look.frame}`}
    >
      <span
        aria-hidden="true"
        className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full border-2 text-lg font-bold ${look.mark} ${
          kind === 'loading' ? 'animate-spin border-t-ink motion-reduce:animate-none' : ''
        }`}
      >
        {look.glyph}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold tracking-wide text-ink-soft">{look.label}</p>
        <p className="mt-0.5 font-semibold text-ink">{title ?? look.title}</p>
        <div className="mt-1 text-sm text-ink">{detail ?? look.detail}</div>
        {step ? (
          <p className="mt-2 text-sm text-ink">
            <span className="font-semibold">Next step: </span>
            {step}
          </p>
        ) : null}
        {action ? <div className="mt-3 flex flex-wrap gap-2">{action}</div> : null}
      </div>
    </div>
  );
}

/** Which frame each typed error uses. Codes, not messages, choose the look. */
export const ERROR_STATE_KIND: Record<ErrorCode, StateKind> = {
  AUTH_REQUIRED: 'forbidden',
  FORBIDDEN: 'forbidden',
  CONFIG_MISSING: 'not_configured',
  SCHEMA_DRIFT: 'blocked',
  NOT_FOUND: 'blocked',
  STALE_READ: 'conflict',
  CONFLICT: 'conflict',
  GATE_BLOCKED: 'blocked',
  AMBIGUOUS_MATCH: 'conflict',
  RATE_LIMITED: 'rate_limited',
  PROVIDER_UNAVAILABLE: 'provider_error',
  PARTIAL_FAILURE: 'partial_failure',
  VALIDATION_FAILED: 'blocked',
  UNKNOWN: 'provider_error',
};

export const ERROR_TITLES: Record<ErrorCode, string> = {
  AUTH_REQUIRED: 'Sign-in needed',
  FORBIDDEN: 'Not allowed for this account',
  CONFIG_MISSING: 'Not configured yet',
  SCHEMA_DRIFT: 'The Sheet layout changed',
  NOT_FOUND: 'Item not found',
  STALE_READ: 'This item changed since you opened it',
  CONFLICT: 'Changed somewhere else first',
  GATE_BLOCKED: 'Blocked by a release gate',
  AMBIGUOUS_MATCH: 'More than one match',
  RATE_LIMITED: 'Slow down requested',
  PROVIDER_UNAVAILABLE: 'Provider unavailable',
  PARTIAL_FAILURE: 'Partly finished',
  VALIDATION_FAILED: 'Input not valid',
  UNKNOWN: 'Something went wrong',
};

export const RECOVERY_STEPS: Record<RecoveryAction, string | null> = {
  sign_in: 'Sign in again.',
  none: null,
  configure: 'Add the missing configuration, then reload.',
  fix_sheet_headers: 'Restore the expected Sheet column headers, then reload.',
  reload: 'Reload the page.',
  compare: 'Compare the versions and choose what to keep.',
  resolve_gate: 'Resolve the listed blocker.',
  choose_match: 'Choose the correct match.',
  retry_later: 'Wait a minute, then try again.',
  retry: 'Try again.',
  retry_pending_steps: 'Retry the pending steps.',
  fix_input: 'Correct the input and submit again.',
};

export function ErrorState({ code, action }: { code: ErrorCode; action?: React.ReactNode }) {
  const entry = ERROR_CATALOGUE[code];
  return (
    <StateView
      kind={ERROR_STATE_KIND[code]}
      title={ERROR_TITLES[code]}
      detail={entry.message}
      nextStep={RECOVERY_STEPS[entry.recovery]}
      action={action}
    />
  );
}
