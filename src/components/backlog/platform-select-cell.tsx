'use client';

import { useEffect, useState } from 'react';
import { PLATFORMS, type Platform } from '@/domain/enums';

/**
 * Target Platform edited in place as a native select (closed enum, so a
 * dropdown is exact rather than free text with suggestions). Changing it saves
 * immediately through the parent's `onSave`; the saving/saved/error status sits
 * next to the select as visible text. Viewers get plain text with no control.
 */
export type PlatformSaveOutcome = { ok: true; note?: string } | { ok: false; message: string };

type Status = { kind: 'saving' } | { kind: 'saved'; note?: string } | { kind: 'error'; message: string };

export function PlatformSelectCell({
  value,
  canEdit,
  libraryId,
  onSave,
}: {
  value: Platform | null;
  canEdit: boolean;
  libraryId: string;
  onSave: (next: Platform | '') => Promise<PlatformSaveOutcome>;
}) {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    if (status?.kind !== 'saved') return;
    const t = setTimeout(() => setStatus(null), 2500);
    return () => clearTimeout(t);
  }, [status]);

  if (!canEdit) return <span className="text-ink-soft">{value ?? '—'}</span>;

  async function change(next: string) {
    const parsed = next === '' ? '' : (next as Platform);
    setStatus({ kind: 'saving' });
    const outcome = await onSave(parsed);
    setStatus(outcome.ok ? { kind: 'saved', note: outcome.note } : { kind: 'error', message: outcome.message });
  }

  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <select
        value={value ?? ''}
        aria-label={`Platform for ${libraryId}`}
        onChange={(e) => void change(e.target.value)}
        className="min-h-8 w-full min-w-0 rounded-sm border border-dashed border-line bg-card px-1.5 py-1 text-sm hover:border-solid hover:border-primary"
      >
        <option value="">—</option>
        {PLATFORMS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      {status ? (
        <span role="status" className={`px-1.5 text-xs ${status.kind === 'error' ? 'font-semibold text-block' : 'text-ink-soft'}`}>
          {status.kind === 'saving' ? 'Saving…' : status.kind === 'saved' ? (status.note ?? 'Saved') : status.message}
        </span>
      ) : null}
    </span>
  );
}
