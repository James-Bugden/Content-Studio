import { isHardStop, type Gate, type GateStatus } from '@/domain/gates';

/**
 * Gate status vocabulary (CS-006, READY-01, UX-02).
 *
 * Every status has a visible word and a glyph with its own shape, so nothing is
 * conveyed by colour alone. The same three levels are used for a whole item
 * (StatusBadge) and for a single gate (GateChip): a hard stop is "Blocked", an
 * ordinary workflow step is "Needs action", and a soft gate is a "Warning".
 */
type Look = { label: string; glyph: string; className: string };

export const STATUS_LOOK: Record<GateStatus, Look> = {
  ready: { label: 'Ready', glyph: '✓', className: 'border-green bg-green-soft text-green rounded-full' },
  needs_action: { label: 'Needs action', glyph: '→', className: 'border-line bg-card text-ink rounded-full' },
  blocked: { label: 'Blocked', glyph: '✕', className: 'border-block bg-block-soft text-block rounded-sm border-2' },
};

const WARNING_LOOK: Look = { label: 'Warning', glyph: '○', className: 'border-line bg-card text-ink-soft rounded-full border-dashed' };

export function gateLook(gate: Gate): Look {
  if (gate.severity === 'soft') return WARNING_LOOK;
  return isHardStop(gate.code) ? STATUS_LOOK.blocked : STATUS_LOOK.needs_action;
}

export function StatusBadge({ status }: { status: GateStatus }) {
  const look = STATUS_LOOK[status];
  return (
    <span className={`inline-flex items-center gap-1.5 border px-2.5 py-0.5 text-sm font-semibold whitespace-nowrap ${look.className}`}>
      <span aria-hidden="true">{look.glyph}</span>
      <span>{look.label}</span>
    </span>
  );
}

/** One gate: level, field and the plain explanation, all visible text. */
export function GateChip({ gate }: { gate: Gate }) {
  const look = gateLook(gate);
  return (
    <span className={`inline-flex max-w-full items-start gap-1.5 border px-2.5 py-1 text-sm ${look.className.replace('rounded-full', 'rounded-md')}`} data-gate-code={gate.code}>
      <span aria-hidden="true" className="font-semibold">
        {look.glyph}
      </span>
      <span className="min-w-0">
        <span className="font-semibold">{look.label}</span>
        <span className="text-ink">
          {' · '}
          {gate.field}: {gate.message}
        </span>
      </span>
    </span>
  );
}

/**
 * The single next action for an item. This is the one place the primary
 * highlight is used on a card, because it is the most important thing to do.
 */
export function NextAction({ gate }: { gate: Gate | null }) {
  if (!gate) {
    return (
      <p className="flex items-start gap-2 text-sm">
        <StatusBadge status="ready" />
        <span className="pt-0.5">Nothing to do here. All release gates pass.</span>
      </p>
    );
  }
  return (
    <div className="rounded-md border border-line bg-card p-3">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="rounded-sm bg-primary-soft px-1.5 text-sm font-semibold text-primary">Next action</span>
        <span className="min-w-0 font-semibold">{gate.nextAction}</span>
      </p>
      <p className="mt-1 text-sm text-ink-soft">
        Why: {gate.message} ({gate.field})
      </p>
    </div>
  );
}
