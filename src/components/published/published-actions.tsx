'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { newOperationId, postJson } from '@/lib/client/api';
import { buttonClass } from '../button-styles';
import { InlineResult, type ResultTone } from '../inline-result';
import { reasonText, type Failure } from '../typefully/reason-text';

/**
 * Owner-only sync actions for one published row (CS-016 PUB-03/04). Each action
 * keeps its operation id until a definitive answer, so a retry after a lost
 * response is the same operation. Conflicts are reported, never auto-resolved.
 */
type Success = { ok: true; replayed: boolean; supplied?: string[]; unavailable?: string[] };
type Action = 'sync-final' | 'analytics';

const RETRY_SAME_OP = new Set(['PROVIDER_UNAVAILABLE', 'PARTIAL_FAILURE', 'RATE_LIMITED', 'UNKNOWN']);

export function PublishedActions({ contentId, revision, linked }: { contentId: string; revision: string; linked: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [result, setResult] = useState<{ tone: ResultTone; text: string } | null>(null);
  const busyRef = useRef(false);
  const ops = useRef<Partial<Record<Action, string>>>({});

  async function run(action: Action) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(action);
    setResult(null);
    const operationId = (ops.current[action] ??= newOperationId(action === 'analytics' ? 'tfa' : 'tfs'));
    try {
      const res = await postJson<Success | Failure>(`/api/schedule/${encodeURIComponent(contentId)}/typefully/${action}`, { operationId, expectedRevision: revision });
      const body = res.body as Success | Failure;
      if (body.ok) {
        delete ops.current[action];
        if (action === 'analytics') {
          const supplied = body.supplied?.length ?? 0;
          const unavailable = body.unavailable?.length ?? 0;
          setResult({
            tone: 'success',
            text: body.replayed
              ? 'Analytics already up to date. Nothing was written.'
              : `Analytics synced: ${supplied} ${supplied === 1 ? 'metric' : 'metrics'} from Typefully; ${unavailable} not available from Typefully and left as they were.`,
          });
        } else {
          setResult({ tone: 'success', text: body.replayed ? 'Final Content already matches Typefully. Nothing was written.' : 'Final Content now holds Typefully’s exact text.' });
        }
        router.refresh();
        return;
      }
      if (!RETRY_SAME_OP.has(body.code)) delete ops.current[action];
      if (body.code === 'STALE_READ') router.refresh();
      setResult({ tone: body.code === 'CONFLICT' || body.code === 'GATE_BLOCKED' ? 'warning' : 'error', text: reasonText(body, null) });
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  if (!linked) return <p className="text-sm text-ink-soft">No Typefully Draft ID, so there is nothing to sync.</p>;
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass('secondary')} disabled={busy !== null} onClick={() => void run('sync-final')}>
          {busy === 'sync-final' ? 'Syncing final copy' : 'Sync final copy'}
        </button>
        <button type="button" className={buttonClass('secondary')} disabled={busy !== null} onClick={() => void run('analytics')}>
          {busy === 'analytics' ? 'Syncing analytics' : 'Sync analytics'}
        </button>
      </div>
      {result ? <InlineResult tone={result.tone}>{result.text}</InlineResult> : null}
    </div>
  );
}
