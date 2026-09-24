'use client';

import { useState } from 'react';
import { ConflictDialog } from '@/components/conflict-dialog';
import { GuardedLink } from '@/components/guarded-link';
import { RecoveryPanel, type RecoveryStep } from '@/components/recovery-panel';
import { useToast } from '@/components/toaster';
import { useDirtyGuard } from '@/components/use-dirty-guard';
import { buttonClass } from '@/components/button-styles';
import { InlineResult } from '@/components/inline-result';

/**
 * Interactive gallery fixtures (CS-006). Synthetic text only; nothing here reads
 * or writes a provider.
 */
export function ToastDemo() {
  const { notify } = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={buttonClass('secondary')} onClick={() => notify('Draft saved to the Sheet and Markdown.', 'success')}>
        Show a success toast
      </button>
      <button type="button" className={buttonClass('secondary')} onClick={() => notify('Typefully sync is running in the background.', 'info')}>
        Show an info toast
      </button>
    </div>
  );
}

export function ConflictDemo({ base, current, proposed }: { base: string | null; current: string; proposed: string }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const pick = (label: string) => () => {
    setChoice(label);
    setOpen(false);
  };
  return (
    <div className="space-y-3">
      <button type="button" className={buttonClass('secondary')} onClick={() => setOpen(true)}>
        {base === null ? 'Open conflict without a base' : 'Open conflict with a base'}
      </button>
      {choice ? <InlineResult tone="info">You chose: {choice}. In the real editor this would run now.</InlineResult> : null}
      <ConflictDialog
        open={open}
        onClose={() => setOpen(false)}
        base={base}
        current={current}
        proposed={proposed}
        actions={[
          { label: 'Keep mine and review again', onSelect: pick('Keep mine and review again'), variant: 'primary' },
          { label: 'Use current', onSelect: pick('Use current') },
          {
            label: 'Copy my version',
            onSelect: () => {
              void navigator.clipboard?.writeText(proposed).catch(() => undefined);
              setChoice('Copy my version');
            },
          },
        ]}
      />
    </div>
  );
}

export function DirtyEditorDemo() {
  const [text, setText] = useState('Synthetic draft: start typing to make this editor dirty.');
  const [saved, setSaved] = useState(text);
  const dirty = text !== saved;
  useDirtyGuard(dirty);
  return (
    <div className="space-y-3">
      <label htmlFor="demo-editor" className="block text-sm font-medium">
        Draft (synthetic)
      </label>
      <textarea
        id="demo-editor"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="copy block w-full rounded-md border border-line bg-card p-2 text-sm"
      />
      <p className="text-sm" aria-live="polite">
        {dirty ? 'Unsaved changes. Leaving through any in-app link will ask first.' : 'All changes saved.'}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonClass('primary')} disabled={!dirty} onClick={() => setSaved(text)}>
          Save draft
        </button>
        <GuardedLink href="/review" className="text-primary underline">
          Go to the review queue
        </GuardedLink>
      </div>
    </div>
  );
}

export function RecoveryDemo({ operationId, steps }: { operationId: string; steps: RecoveryStep[] }) {
  const { notify } = useToast();
  return <RecoveryPanel operationId={operationId} steps={steps} onRetry={() => notify('Retry requested for the remaining steps (demo only).', 'info')} />;
}
