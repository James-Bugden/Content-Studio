import type { NextStep } from '@/domain/next-steps';
import { OpenPanelLink } from './open-panel-link';

/**
 * The single next step as a button that opens the side panel on the right item
 * (UX redesign, Calm Signal). Only a genuinely urgent step (`urgency === 'now'`)
 * gets the strong red-outlined treatment; every other step is a quiet
 * default-weight button, so the urgent ones actually stand out. Urgent steps are
 * marked with text and shape, not colour only.
 */
export function StepButton({ step, target, size = 'md' }: { step: NextStep; target: { post: string } | { slot: string }; size?: 'sm' | 'md' }) {
  if (step.kind === 'done' || step.kind === 'wait') {
    return <span className="text-xs text-ink-soft">{step.action}</span>;
  }
  const urgent = step.urgency === 'now';
  const pad = size === 'sm' ? 'min-h-9 px-2.5 text-xs' : 'min-h-11 px-4 text-sm';
  return (
    <OpenPanelLink
      target={target}
      label={`${step.action}: ${step.why}`}
      className={`inline-flex items-center gap-1.5 rounded-md font-medium ${pad} ${
        urgent
          ? 'border-2 border-block bg-block-soft text-block hover:bg-block-soft/70'
          : 'border border-line bg-card text-ink hover:bg-paper'
      }`}
    >
      {urgent ? <span aria-hidden="true">!</span> : null}
      {step.action}
    </OpenPanelLink>
  );
}
