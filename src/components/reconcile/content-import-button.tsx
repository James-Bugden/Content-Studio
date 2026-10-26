'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonClass } from '../button-styles';
import { completeCutover, pendingCutover } from './cutover-retry';

export function ContentImportButton({ label = 'Run content import', disabled = false, onComplete, onPending }: { label?: string; disabled?: boolean; onComplete?: () => void; onPending?: (pending: boolean) => void }) {
  const router = useRouter();
  const requestKey = useRef<string | null>(null);
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  async function run() {
    if (running.current) return;
    running.current = true;
    setPending(true); onPending?.(true); setMessage('');
    try {
      requestKey.current ??= pendingCutover('import', null).key;
      const response = await fetch('/api/ops/sheet-mirror', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey.current } });
      const result = await response.json();
      setMessage(response.ok && result.ok === true ? result.status === 'in_progress' ? 'Content import already running. Retry to check completion with the same request.' : result.status === 'replayed' ? 'Content import already completed. No new run started.' : result.status === 'completed' ? 'Content import completed.' : 'Content import is unconfirmed. Retry with the same request.' : 'Content import failed. Retry in a moment.');
      if (response.ok && result.ok === true && ['completed', 'replayed'].includes(result.status)) {
        completeCutover('import'); requestKey.current = null; onComplete?.();
      }
      router.refresh();
    } catch { setMessage('Content import failed. Retry in a moment.'); }
    finally { running.current = false; setPending(false); onPending?.(false); }
  }
  return <div className="mt-3"><button type="button" className={buttonClass('secondary')} onClick={run} disabled={pending || disabled}>{pending ? 'Importing…' : label}</button><p role="status" className="mt-2 text-sm">{message}</p></div>;
}
