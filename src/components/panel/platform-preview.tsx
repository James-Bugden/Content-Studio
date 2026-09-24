import type { Thumb } from '@/domain/next-steps';

/**
 * How the post will read on its platform (UX redesign): a plain, platform-shaped
 * card with the exact text (pre-wrapped, never trimmed) and the image under it.
 * It is a reading aid, not a pixel copy of X, Threads or LinkedIn.
 */
const LOOK: Record<string, { name: string; handle: string; lang: string }> = {
  X: { name: 'You', handle: 'on X', lang: 'en-GB' },
  LinkedIn: { name: 'You', handle: 'on LinkedIn', lang: 'en-GB' },
  Threads: { name: 'You', handle: 'on Threads', lang: 'zh-Hant-TW' },
};

export function PlatformPreview({ platform, text, thumb }: { platform: string; text: string; thumb: Thumb | null }) {
  const look = LOOK[platform] ?? { name: 'You', handle: platform, lang: 'en-GB' };
  return (
    <article aria-label={`Preview on ${platform}`} className="rounded-xl border border-line bg-card p-4 shadow-[0_1px_2px_rgba(23,32,35,0.06)]">
      <header className="flex items-center gap-3">
        <span aria-hidden="true" className="inline-flex size-10 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">
          J
        </span>
        <div className="leading-tight">
          <p className="font-semibold">{look.name}</p>
          <p className="text-xs text-ink-soft">{look.handle}</p>
        </div>
      </header>
      {text.trim() ? (
        <p lang={look.lang} className="copy mt-3 text-[15px] leading-relaxed">
          {text}
        </p>
      ) : (
        <p className="mt-3 text-sm text-ink-soft">No copy yet.</p>
      )}
      {thumb?.src ? (
        // eslint-disable-next-line @next/next/no-img-element -- same-origin, auth-gated, sandboxed image route
        <img src={thumb.src} alt="" className="mt-3 w-full rounded-lg border border-line" />
      ) : null}
      <p className="mt-2 text-xs text-ink-soft">{thumb ? `Image: ${thumb.label}` : 'No image'}</p>
    </article>
  );
}
