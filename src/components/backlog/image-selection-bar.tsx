'use client';
import { buttonClass } from '../button-styles';

export function ImageSelectionBar({ count, all, busy, onAll, onCheck, onCreate }: {
  count: number; all: boolean; busy: boolean; onAll: (checked: boolean) => void; onCheck: () => void; onCreate: () => void;
}) {
  return <div aria-label="Image selection" className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-card p-3 text-sm">
    <label className="inline-flex min-h-11 items-center gap-2"><input type="checkbox" checked={all} disabled={busy} onChange={e => onAll(e.target.checked)} /> Select all on page</label>
    <span role="status">{count} selected</span>
    <button type="button" className={buttonClass()} disabled={busy || !count || count > 25} onClick={onCheck}>Check images</button>
    <button type="button" className={buttonClass()} disabled={busy || !count || count > 25} onClick={onCreate}>Create images</button>
    {count > 25 ? <p className="w-full text-attention">Select up to 25 posts per run.</p> : null}
  </div>;
}
