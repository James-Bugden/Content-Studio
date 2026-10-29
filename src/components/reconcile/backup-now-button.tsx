'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buttonClass } from '../button-styles';

/**
 * Owner's "Back up now". One UUID per attempt: a retry after a lost response
 * reuses it (the server replays that run), and a finished run clears it.
 */
export function BackupNowButton() {
  const router = useRouter();
  const key = useRef<string | null>(null);
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  async function run() {
    if (running.current) return;
    running.current = true;
    setPending(true); setMessage('');
    try {
      key.current ??= crypto.randomUUID();
      const response = await fetch('/api/ops/backup', { method: 'POST', headers: { 'Idempotency-Key': key.current } });
      const result = await response.json().catch(() => null);
      if (response.ok && result?.ok === true && result.status === 'busy') setMessage('A backup is already running. Check again in a minute.');
      else if (response.ok && result?.ok === true) { setMessage('Backup finished and verified.'); key.current = null; }
      else if (result?.status === 'failure') { setMessage('Backup failed. Your earlier backups were kept. Try again.'); key.current = null; }
      else setMessage('Backup could not start. Try again in a moment.');
      router.refresh();
    } catch {
      setMessage('Backup could not be confirmed. Press again to check the same request.');
    } finally { running.current = false; setPending(false); }
  }
  return (
    <div className="mt-3">
      <button type="button" className={buttonClass('secondary')} onClick={run} disabled={pending}>{pending ? 'Backing up…' : 'Back up now'}</button>
      <p role="status" className="mt-2 text-sm">{message}</p>
    </div>
  );
}
