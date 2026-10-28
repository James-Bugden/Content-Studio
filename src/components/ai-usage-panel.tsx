'use client';
import { useEffect, useRef, useState } from 'react';
import { aiUsageSchema, type AiUsage } from '@/domain/ai-usage';
import { AiUsageMeter, aiMoney } from './ai-usage-meter';
import { buttonClass } from './button-styles';

const FEATURES = { image_check: 'Check images', ascii_sketch: 'ASCII sketch', image_render: 'Create image', image_need: 'Image check', bank_image_tags: 'Image tags', english_qa: 'Check English', hooks: 'Hooks', zh_tw: 'Chinese adapt', zh_qa: 'Chinese check',
  replies_ideas: 'Reply ideas', replies_rewrite: 'Reply rewrite', replies_translation: 'Reply translation', embeddings: 'Embeddings' };
export function AiUsagePanel() {
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [cap, setCap] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const operation = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/ai-usage', { cache: 'no-store' }).then(async response => {
      const parsed = aiUsageSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error('usage');
      if (alive) { setUsage(parsed.data); setCap(String(parsed.data.capMicros / 1_000_000)); }
    }).catch(() => { if (alive) setMessage('AI usage unavailable. Reload to try again.'); });
    return () => { alive = false; };
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!usage || saving) return;
    const capMicros = Math.round(Number(cap) * 1_000_000);
    if (!/^\d+(\.\d{1,2})?$/.test(cap) || capMicros > 1_000_000_000) { setMessage('Enter a limit from $0 to $1,000 with up to two decimal places.'); return; }
    const key = `${usage.version}:${capMicros}`;
    if (operation.current?.key !== key) operation.current = { key, id: crypto.randomUUID() };
    setSaving(true); setMessage('');
    try {
      const response = await fetch('/api/ai-usage', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operationId: operation.current.id, expectedVersion: usage.version, capMicros }) });
      const result = await response.json();
      if (!response.ok) {
        if (result.code === 'STALE_READ') {
          const fresh = await fetch('/api/ai-usage', { cache: 'no-store' });
          const parsed = aiUsageSchema.safeParse(await fresh.json());
          if (fresh.ok && parsed.success) { setUsage(parsed.data); setCap(String(parsed.data.capMicros / 1_000_000)); }
          setMessage('Monthly limit changed elsewhere. Review the current limit and try again.');
        } else setMessage(result.message || 'Limit not saved. Try again.');
        return;
      }
      const fresh = await fetch('/api/ai-usage', { cache: 'no-store' });
      const parsed = aiUsageSchema.safeParse(await fresh.json());
      if (!fresh.ok || !parsed.success) throw new Error('refresh');
      setUsage(parsed.data); setMessage('Monthly limit saved.'); operation.current = null;
    } catch { setMessage('Could not confirm the monthly limit. Retry to confirm safely.'); }
    finally { setSaving(false); }
  }
  return <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4">
    <h1 className="text-2xl font-semibold">AI usage</h1>
    {usage ? <>
      <AiUsageMeter usage={usage} />
      <form onSubmit={save} className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-col gap-1 text-sm">Monthly limit (USD)
          <input className="min-h-11 w-40 rounded-md border border-line bg-card px-3" type="number" inputMode="decimal" min="0" max="1000" step="0.01" required value={cap} onChange={e => setCap(e.target.value)} />
        </label>
        <button className={buttonClass()} disabled={saving} type="submit">{saving ? 'Saving…' : 'Save limit'}</button>
      </form>
      <section aria-label="Recent AI calls"><h2 className="mb-3 font-semibold">Recent calls</h2>
        {usage.calls.length === 0 ? <p className="text-sm text-ink-soft">No AI calls yet.</p> : <ul className="divide-y divide-line">
          {usage.calls.map(call => <li key={call.id} className="py-3 text-sm">
            <div className="flex justify-between gap-3"><span className="font-semibold">{FEATURES[call.feature]}</span><span className="shrink-0">{aiMoney(call.costMicros)}</span></div>
            <p className="break-words text-ink-soft">{call.model} · {call.inputTokens.toLocaleString('en-US')} in / {call.outputTokens.toLocaleString('en-US')} out</p>
            <time className="text-xs text-ink-soft" dateTime={call.timestamp}>{new Date(call.timestamp).toLocaleString('en-GB', { timeZone: 'Asia/Taipei' })} Taipei</time>
            {call.status !== 'completed' ? <p className="text-xs text-attention">{call.status === 'pending' ? 'In progress · reserved estimate' : 'Unconfirmed tokens · reserved estimate'}</p> : null}
          </li>)}
        </ul>}
      </section>
    </> : !message ? <p role="status">Loading AI usage</p> : null}
    {message ? <p role="status" className="text-sm">{message}</p> : null}
  </div>;
}
