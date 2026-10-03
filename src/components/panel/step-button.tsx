import type { NextStep } from '@/domain/next-steps';
import { buttonCraft } from '../button-styles';
import { OpenPanelLink } from './open-panel-link';

/**
 * The single next step as a button that opens the side panel on the right item.
 * Linear-style (CS-045): every step is a quiet outlined button and urgency is
 * carried by the row (a red dot plus words), not by the button, so a list of
 * urgent tasks no longer turns into a wall of red. `primary` fills the one main
 * action on a page, such as the first task on Next up.
 */
export function StepButton({ step, target, size = 'md', primary = false }: { step: NextStep; target: { post: string } | { slot: string }; size?: 'sm' | 'md'; primary?: boolean }) {
  if (step.kind === 'done' || step.kind === 'wait') {
    return <span className="text-xs text-ink-soft">{step.action}</span>;
  }
  const pad = size === 'sm' ? 'min-h-9 px-2.5 text-xs' : 'min-h-11 px-4 text-sm';
  return (
    <OpenPanelLink
      target={target}
      label={`${step.action}: ${step.why}`}
      className={`inline-flex items-center gap-1.5 rounded-md font-medium whitespace-nowrap ${buttonCraft} ${pad} ${
        primary
          ? 'border border-primary bg-primary text-white hover:bg-primary/85'
          : 'border border-line bg-card text-ink hover:bg-paper'
      }`}
    >
      {step.action}
    </OpenPanelLink>
  );
}
