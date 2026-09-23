'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Gate } from '@/domain/gates';
import { newOperationId, postJson } from '@/lib/client/api';
import { buttonClass } from '../button-styles';
import { GateChip } from '../status';
import { InlineResult } from '../inline-result';

/**
 * Explicit promotion confirmation (CS-014). The operation id is created once per
 * preview, so a double click or a retry after a lost response is the same
 * operation and cannot fill two slots.
 */
type Result = { ok: true; replayed: boolean; contentId: string } | { ok: false; code: string; message?: string; problems?: string[]; blockers?: Gate[] };

export function PromoteConfirm(props: { libraryId: string; contentId: string; libraryRevision: string; scheduleRevision: string }) {
  const router = useRouter();
  const [opId] = useState(() => newOperationId('promote'));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function confirm() {
    setBusy(true);
    const res = await postJson<Result>('/api/schedule/promote', {
      operationId: opId,
      libraryId: props.libraryId,
      contentId: props.contentId,
      expectedLibraryRevision: props.libraryRevision,
      expectedScheduleRevision: props.scheduleRevision,
    });
    setBusy(false);
    setResult(res.body as Result);
  }

  if (result?.ok) {
    return (
      <InlineResult tone="success">
        Scheduled into {result.contentId}
        {result.replayed ? ' (it was already there)' : ''}.{' '}
        <button type="button" className="underline" onClick={() => router.push('/schedule')}>
          Open the schedule
        </button>
      </InlineResult>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {result && !result.ok ? (
        <InlineResult tone={result.code === 'STALE_READ' ? 'warning' : 'error'}>
          {result.problems?.join(' ') || result.message || 'Not scheduled. Nothing was written.'}
          {result.code === 'STALE_READ' ? ' Reload this page to see the new preview.' : ''}
        </InlineResult>
      ) : null}
      {result && !result.ok && result.blockers?.length ? (
        <ul className="flex flex-col gap-1.5">
          {result.blockers.map((g, i) => (
            <li key={`${g.code}-${i}`}>
              <GateChip gate={g} />
            </li>
          ))}
        </ul>
      ) : null}
      <div>
        <button type="button" className={buttonClass('primary')} disabled={busy} onClick={() => void confirm()}>
          {busy ? 'Scheduling…' : `Confirm and write to ${props.contentId}`}
        </button>
      </div>
    </div>
  );
}
