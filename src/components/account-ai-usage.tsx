'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { aiUsageSchema, type AiUsage } from '@/domain/ai-usage';
import { AiUsageMeter } from './ai-usage-meter';

export function AccountAiUsage() {
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let sequence = 0;
    async function refresh() {
      const mine = ++sequence;
      try {
        const response = await fetch('/api/ai-usage', { cache: 'no-store' });
        const parsed = aiUsageSchema.safeParse(await response.json());
        if (!response.ok || !parsed.success) throw new Error('usage');
        if (alive && mine === sequence) { setUsage(parsed.data); setFailed(false); }
      } catch { if (alive && mine === sequence) setFailed(true); }
    }
    function onToggle(event: Event) {
      if (event.target instanceof HTMLDetailsElement && event.target.open && event.target.classList.contains('studio-account')) void refresh();
    }
    document.addEventListener('toggle', onToggle, true);
    return () => { alive = false; document.removeEventListener('toggle', onToggle, true); };
  }, []);
  return <div className="mb-4 border-b border-line pb-3">
    {failed ? <p role="status" className="text-sm">AI usage unavailable</p> : usage ? <AiUsageMeter usage={usage} /> : <p className="text-sm">AI usage: loading</p>}
    <Link href="/ai-usage" className="mt-2 inline-flex min-h-11 items-center text-sm underline" onClick={event => {
      const menu = event.currentTarget.closest('details');
      if (menu) menu.open = false;
    }}>Usage and monthly limit</Link>
  </div>;
}
