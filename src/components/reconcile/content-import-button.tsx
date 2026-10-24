'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonClass } from '../button-styles';

export function ContentImportButton() {
  const router = useRouter();
  const requestKey = useRef<string | null>(null);
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  async function run() {
    if (running.current) return;
    running.current = true;
    requestKey.current ??= crypto.randomUUID();
    setPending(true); setMessage('');
    try {
      const response = await fetch('/api/ops/sheet-mirror', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey.current } });
      const result = await response.json();
      setMessage(response.ok ? result.status === 'in_progress' ? 'Content import already running. No new run started.' : result.status === 'replayed' ? 'Content import already completed. No new run started.' : 'Content import completed.' : 'Content import failed. Retry in a moment.');
      if (response.ok) requestKey.current = null;
      router.refresh();
    } catch { setMessage('Content import failed. Retry in a moment.'); }
    finally { running.current = false; setPending(false); }
  }
  return <div className="mt-3"><button type="button" className={buttonClass('secondary')} onClick={run} disabled={pending}>{pending ? 'Importing…' : 'Run content import'}</button><p role="status" className="mt-2 text-sm">{message}</p></div>;
}
