import type { Thumb } from '@/domain/next-steps';

/**
 * Post image thumbnail (UX redesign). Shows the actual image when there is one
 * and always says in words what state it is in, so a finished visual is visible
 * on the post and a missing or stale one is obvious without colour alone.
 */
const TONE: Record<Thumb['tone'], string> = {
  done: 'border-green/40 bg-green-soft text-green',
  todo: 'border-warn/40 bg-warn-soft text-warn',
  problem: 'border-block/50 bg-block-soft text-block',
  none: 'border-line bg-paper text-ink-soft',
};
const GLYPH: Record<Thumb['tone'], string> = { done: '✓', todo: '○', problem: '!', none: '·' };

export function PostThumb({ thumb, size = 'md', showLabel = true }: { thumb: Thumb | null; size?: 'sm' | 'md' | 'lg'; showLabel?: boolean }) {
  const t: Thumb = thumb ?? { src: null, label: 'No image', tone: 'none' };
  const box = size === 'sm' ? 'size-12' : size === 'lg' ? 'w-full aspect-square max-w-sm' : 'size-20';
  return (
    <figure className="flex min-w-0 flex-col gap-1">
      <div className={`${box} shrink-0 overflow-hidden rounded-md border ${t.src ? 'border-line bg-card' : TONE[t.tone]} flex items-center justify-center`}>
        {t.src ? (
          // eslint-disable-next-line @next/next/no-img-element -- same-origin, auth-gated, sandboxed image route
          <img src={t.src} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
        ) : (
          <span aria-hidden="true" className="text-center text-[10px] font-semibold leading-tight">
            {t.label === 'Text only' ? 'Aa' : GLYPH[t.tone]}
          </span>
        )}
      </div>
      {showLabel ? (
        <figcaption className={`inline-flex items-center gap-1 text-xs ${t.tone === 'problem' ? 'text-block' : t.tone === 'todo' ? 'text-warn' : 'text-ink-soft'}`}>
          <span aria-hidden="true">{GLYPH[t.tone]}</span>
          {t.label}
        </figcaption>
      ) : (
        <figcaption className="sr-only">{t.label}</figcaption>
      )}
    </figure>
  );
}
