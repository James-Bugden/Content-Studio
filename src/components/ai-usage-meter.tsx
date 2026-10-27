import { aiUsageLevel, type AiUsage } from '@/domain/ai-usage';

export function aiMoney(micros: number) {
  if (micros > 0 && micros < 100) return '<$0.0001';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(micros / 1_000_000);
}
export function AiUsageMeter({ usage }: { usage: Pick<AiUsage, 'spentMicros' | 'capMicros' | 'resetsAt'> }) {
  const level = aiUsageLevel(usage.spentMicros, usage.capMicros);
  const percent = usage.capMicros === 0 ? 100 : Math.min(100, usage.spentMicros / usage.capMicros * 100);
  return <div className="min-w-0 text-sm" data-ai-usage={level}>
    <div className="flex flex-wrap justify-between gap-x-3 gap-y-1"><span className="font-semibold">AI usage</span>
      <span>{aiMoney(usage.spentMicros)} / {aiMoney(usage.capMicros)}</span></div>
    <div role="progressbar" aria-label="Monthly AI usage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}
      aria-valuetext={`${aiMoney(usage.spentMicros)} of ${aiMoney(usage.capMicros)}`} className="mt-2 h-2 overflow-hidden rounded-full bg-line">
      <div className={`h-full ${level === 'blocked' ? 'bg-block' : level === 'warning' ? 'bg-attention' : 'bg-ink'}`} style={{ width: `${percent}%` }} />
    </div>
    <p className="mt-1 text-xs text-ink-soft">Estimated USD · Resets on the 1st (Taipei)</p>
    {level !== 'normal' ? <p role="status" className={`mt-2 ${level === 'blocked' ? 'text-block' : 'text-attention'}`}>
      {level === 'blocked' ? 'Monthly AI limit reached' : '80% of monthly AI limit used'}</p> : null}
  </div>;
}
