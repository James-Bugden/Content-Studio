/**
 * Result of an action, shown next to the thing it concerns (CS-006).
 *
 * Tone is never colour alone: each tone has a glyph and a visible word. Errors use
 * role="alert" so they are announced at once; everything else is polite.
 */
export type ResultTone = 'success' | 'info' | 'warning' | 'error';

export const TONES: Record<ResultTone, { label: string; glyph: string; box: string }> = {
  success: { label: 'Done', glyph: '✓', box: 'border-green bg-green-soft text-green' },
  info: { label: 'Note', glyph: 'i', box: 'border-line bg-card text-ink' },
  warning: { label: 'Check', glyph: '●', box: 'border-block bg-block-soft text-block' },
  error: { label: 'Error', glyph: '✕', box: 'border-block bg-block-soft text-block' },
};

export function InlineResult({ tone, children }: { tone: ResultTone; children: React.ReactNode }) {
  const t = TONES[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-md border-l-4 px-4 py-3 text-sm ${t.box}`}>
      <span aria-hidden="true" className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-current text-xs font-bold">
        {t.glyph}
      </span>
      <div className="min-w-0 flex-1 text-ink">
        <span className="font-semibold">{t.label}: </span>
        {children}
      </div>
    </div>
  );
}
