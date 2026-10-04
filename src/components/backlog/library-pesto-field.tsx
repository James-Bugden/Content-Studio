'use client';

import { useEffect, useMemo, useState } from 'react';
import { newOperationId, postJson } from '@/lib/client/api';
import { PillarTag } from '../pillar-tag';
import { pestoChoices } from './pesto-choices';

/**
 * PESTO stage on a Content Library post (CS-054), picked from a dropdown
 * (CS-055: the free-text box with suggestions showed no real picker). Changing it
 * saves immediately with the row's Sheet revision; consecutive edits each send
 * the revision the last one produced, and a post that changed in the Sheet
 * meanwhile is refused (STALE_READ) with nothing written. Viewers see the tag only.
 */
type Outcome = { ok: true; pesto: string; revision: string; replayed: boolean } | { ok: false; code: string; message?: string };
type Status = { kind: 'saving' } | { kind: 'saved'; note?: string } | { kind: 'error'; message: string };

export function LibraryPestoField({ libraryId, value, revision, canEdit, suggestions = [], onSaved }: {
  libraryId: string;
  value: string;
  revision: string;
  canEdit: boolean;
  /** PESTO values already in the Sheet; the five stages are always offered. */
  suggestions?: readonly string[];
  /** Called with the new Sheet revision after a successful save. */
  onSaved?: (revision: string) => void;
}) {
  const [current, setCurrent] = useState({ value, revision });
  const [status, setStatus] = useState<Status | null>(null);
  const options = useMemo(() => pestoChoices(suggestions, current.value), [suggestions, current.value]);

  useEffect(() => {
    if (status?.kind !== 'saved') return;
    const t = setTimeout(() => setStatus(null), 2500);
    return () => clearTimeout(t);
  }, [status]);

  if (!canEdit) return <PillarTag value={current.value} emptyLabel="No PESTO stage" />;

  async function change(next: string) {
    const previous = current.value;
    setCurrent((c) => ({ ...c, value: next }));
    setStatus({ kind: 'saving' });
    const res = await postJson<Outcome>(`/api/library/${encodeURIComponent(libraryId)}/fields`, {
      operationId: newOperationId('pesto'),
      libraryId,
      expectedRevision: current.revision,
      patch: { pesto: next },
    });
    const body = res.body as Outcome;
    if (body.ok) {
      setCurrent({ value: body.pesto, revision: body.revision });
      setStatus({ kind: 'saved', note: body.replayed ? 'Already saved' : undefined });
      onSaved?.(body.revision);
      return;
    }
    setCurrent((c) => ({ ...c, value: previous }));
    setStatus({
      kind: 'error',
      message: body.code === 'STALE_READ' ? 'This post changed in the Sheet. Reload, then try again.'
        : body.code === 'FORBIDDEN' ? 'Not saved: this account cannot edit posts.'
          : body.message || 'Not saved. Nothing was written.',
    });
  }

  return (
    <span data-pesto-field className="flex min-w-0 flex-col gap-0.5">
      <select
        value={current.value.trim()}
        aria-label={`PESTO stage for ${libraryId}`}
        disabled={status?.kind === 'saving'}
        onChange={(e) => void change(e.target.value)}
        className="min-h-8 w-full min-w-0 rounded-sm border border-dashed border-line bg-card px-1.5 py-1 text-sm hover:border-solid hover:border-primary disabled:opacity-60"
      >
        <option value="">No PESTO stage</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {status ? (
        <span role="status" className={`px-1.5 text-xs ${status.kind === 'error' ? 'font-semibold text-block' : 'text-ink-soft'}`}>
          {status.kind === 'saving' ? 'Saving…' : status.kind === 'saved' ? (status.note ?? 'Saved') : status.message}
        </span>
      ) : null}
    </span>
  );
}
