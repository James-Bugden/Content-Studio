'use client';

import { buttonClass } from './button-styles';

/**
 * Truthful account of a cross-provider saga (CS-006, MASTER-SPEC section 7).
 *
 * Lists every step with its real outcome so a partial failure is never presented
 * as success. Steps skipped because they were already applied are shown as such:
 * retrying is safe because the operation ID makes each step idempotent.
 */
export type RecoveryStepStatus = 'done' | 'skipped_already_applied' | 'failed' | 'pending';
export type RecoveryStep = { step: string; status: RecoveryStepStatus; provider: string };

export const STEP_LOOK: Record<RecoveryStepStatus, { label: string; glyph: string; className: string }> = {
  done: { label: 'Done', glyph: '✓', className: 'text-green' },
  skipped_already_applied: { label: 'Already applied, skipped', glyph: '✓', className: 'text-green' },
  failed: { label: 'Failed', glyph: '✕', className: 'text-block' },
  pending: { label: 'Not run yet', glyph: '○', className: 'text-ink-soft' },
};

export type RecoveryPanelProps = {
  operationId: string;
  steps: RecoveryStep[];
  onRetry?: () => void;
};

export function RecoveryPanel({ operationId, steps, onRetry }: RecoveryPanelProps) {
  const finished = steps.filter((s) => s.status === 'done' || s.status === 'skipped_already_applied').length;
  const failed = steps.filter((s) => s.status === 'failed').length;
  const remaining = steps.length - finished;
  const complete = remaining === 0;

  return (
    <section aria-label="Recovery" className={`rounded-lg border bg-card p-4 ${complete ? 'border-line' : 'border-block border-l-4'}`}>
      <h3 className="font-semibold">{complete ? 'All steps finished' : 'Some steps still need to run'}</h3>
      <p className="mt-1 text-sm text-ink-soft">
        {finished} of {steps.length} steps finished
        {failed > 0 ? `, ${failed} failed` : ''}. Operation <code className="font-mono [overflow-wrap:anywhere]">{operationId}</code>
      </p>
      <ol className="mt-3 space-y-2">
        {steps.map((s, index) => {
          const look = STEP_LOOK[s.status];
          return (
            <li key={`${index}-${s.step}`} className="flex items-start gap-3 text-sm" data-step-status={s.status}>
              <span aria-hidden="true" className={`w-4 shrink-0 text-center font-bold ${look.className}`}>
                {look.glyph}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{s.step}</span>
                <span className="text-ink-soft"> ({s.provider})</span>
              </span>
              <span className={`shrink-0 font-semibold ${look.className}`}>{look.label}</span>
            </li>
          );
        })}
      </ol>
      {!complete ? (
        <p className="mt-3 text-sm">Finished steps are kept and will be skipped on retry, so retrying cannot apply anything twice.</p>
      ) : null}
      {onRetry && !complete ? (
        <div className="mt-3">
          <button type="button" className={buttonClass('primary')} onClick={onRetry}>
            Retry remaining steps
          </button>
        </div>
      ) : null}
    </section>
  );
}
