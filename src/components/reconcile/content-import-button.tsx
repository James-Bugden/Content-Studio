'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonClass } from '../button-styles';

export function ContentImportButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  async function run() {
    setPending(true); setMessage('');
    try {
      const response = await fetch('/api/ops/sheet-mirror', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      setMessage(response.ok ? 'Content import completed.' : 'Content import failed. Retry in a moment.');
      router.refresh();
    } catch { setMessage('Content import failed. Retry in a moment.'); }
    finally { setPending(false); }
  }
  return <div className="mt-3"><button type="button" className={buttonClass('secondary')} onClick={run} disabled={pending}>{pending ? 'Importing…' : 'Run content import'}</button><p role="status" className="mt-2 text-sm">{message}</p></div>;
}
