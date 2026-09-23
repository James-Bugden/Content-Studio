'use client';

import { ModalDialog } from './modal-dialog';
import { buttonClass, type ButtonVariant } from './button-styles';

/**
 * Three-way conflict view (CS-006, MASTER-SPEC section 7).
 *
 * Shows exactly what each side holds, character for character, so James can see
 * what changed before choosing. Text is rendered pre-wrapped and never trimmed,
 * normalised or truncated: line breaks, CJK and emoji must survive untouched. The
 * dialog never picks a winner itself; every way out is an explicit action passed
 * in by the caller, and Escape only closes (keeping both versions).
 */
export type ConflictAction = { label: string; onSelect: () => void; variant?: ButtonVariant };

export type ConflictDialogProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: React.ReactNode;
  /** The version the edit started from, when it could be loaded. */
  base?: string | null;
  /** What the source (Sheet, Drive or Typefully) holds now. */
  current: string;
  /** The edit being saved. */
  proposed: string;
  actions: ConflictAction[];
};

function Pane({ label, hint, text }: { label: string; hint: string; text: string }) {
  return (
    <section aria-label={label} className="flex min-w-0 flex-col rounded-md border border-line">
      <h3 className="border-b border-line bg-paper px-3 py-2 text-sm font-semibold">
        {label} <span className="font-normal text-ink-soft">({hint})</span>
      </h3>
      <div className="copy min-h-24 px-3 py-2 text-sm" data-pane={label}>
        {text}
      </div>
    </section>
  );
}

export function ConflictDialog({
  open,
  onClose,
  title = 'This changed somewhere else',
  description = 'Both versions are kept. Nothing was overwritten. Compare them and choose what to keep.',
  base,
  current,
  proposed,
  actions,
}: ConflictDialogProps) {
  const hasBase = typeof base === 'string';
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      wide
      tone="warning"
      title={title}
      description={description}
      footer={
        <>
          {actions.map((action) => (
            <button key={action.label} type="button" className={buttonClass(action.variant ?? 'secondary')} onClick={action.onSelect}>
              {action.label}
            </button>
          ))}
          <button type="button" className={buttonClass('secondary')} onClick={onClose}>
            Close and decide later
          </button>
        </>
      }
    >
      <div className={`grid gap-3 ${hasBase ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        {hasBase ? <Pane label="Base" hint="when loaded" text={base} /> : null}
        <Pane label="Current" hint="source now" text={current} />
        <Pane label="Proposed" hint="your edit" text={proposed} />
      </div>
      {!hasBase ? <p className="mt-3 text-sm text-ink-soft">The version you started from could not be loaded, so only two versions are shown.</p> : null}
    </ModalDialog>
  );
}
