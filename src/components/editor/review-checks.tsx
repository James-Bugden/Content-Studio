'use client';

import { useRef, useState } from 'react';
import { DUPLICATE_QA } from '@/domain/enums';
import type { EditorModel } from '@/domain/views';
import { newOperationId, postJson } from '@/lib/client/api';
import { InlineResult } from '../inline-result';

/** Human risk decisions use the same guarded field edit as the chosen hook. */
export function ReviewChecks({ model, revision, disabled, onSaved }: { model: EditorModel; revision: string; disabled: boolean; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<{ key: string; id: string } | null>(null);
  async function save(field: 'duplicateQa', value: string) {
    setBusy(true); setError('');
    const key = JSON.stringify([revision, field, value]);
    const operationId = pending.current?.key === key ? pending.current.id : newOperationId('qa');
    pending.current = { key, id: operationId };
    const { body } = await postJson<{ ok: boolean; message?: string }>(`/api/library/${encodeURIComponent(model.libraryId)}/fields`, {
      libraryId: model.libraryId, operationId, expectedRevision: revision, patch: { [field]: value },
    });
    setBusy(false);
    if (body.ok) { pending.current = null; onSaved(); }
    else setError(body.message || 'QA decision was not saved. Reload and try again.');
  }
  return <section aria-label="Approval checks" className="space-y-3 rounded-lg border border-line p-3">
    <h3 className="font-semibold">Approval checks</h3>
    {model.gates.blockers.filter(g => !/^(VISUAL_|SCREENSHOT_|REVIEW_PENDING|REVIEW_CHANGES_REQUESTED)/.test(g.code)).map((g, i) => <p key={`${g.code}-${i}`} className="text-base">{g.field}: {g.nextAction}</p>)}
    <div className="flex flex-wrap gap-3">
      <label className="min-w-0 text-sm">Duplicate QA<select className="mt-1 block min-h-11 rounded-md border border-line bg-card px-3 text-base" disabled={disabled || busy} value={model.qa?.duplicate ?? ''} onChange={e => void save('duplicateQa', e.target.value)}>
        <option value="" disabled>Choose a decision</option>{DUPLICATE_QA.map(v => <option key={v} value={v}>{v === 'PASS' ? 'No duplicate' : v === 'CHECK' ? 'Needs checking' : v === 'DUPLICATE' ? 'Confirmed duplicate' : 'Unchecked'}</option>)}
      </select></label>
    </div>
    {disabled ? <p className="text-sm">Save the draft before changing QA decisions.</p> : null}
    {error ? <InlineResult tone="error">{error}</InlineResult> : null}
  </section>;
}
