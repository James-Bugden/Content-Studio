'use client';

import Link from 'next/link';
import { NAV, PROGRESS } from '@/replies/lib/workspace/copy';
import { PLATFORM_LABELS, type Platform } from '@/replies/lib/contracts/vocabulary';
import type { Progress } from '@/replies/lib/contracts/api';

/**
 * Header and daily progress (D02).
 *
 * Counters use full platform names and tabular numerals, and they wrap to a second
 * row rather than shrinking, because 13 px metadata that shrinks further is not
 * readable and the alternative costs one row of height.
 *
 * A count can exceed its target. 11/10 is shown as 11/10: clamping it would throw
 * away the one number the owner is actually trying to beat.
 */

export function AppHeader({ progress }: { progress: Progress | null }) {
  const platforms = Object.keys(PLATFORM_LABELS) as Platform[];

  return (
    <header className="border-b border-hairline bg-paper px-4 py-3">
      <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-2">
        <Link href="/replies" className="text-[0.9375rem] font-semibold text-ink">
          {NAV.title}
        </Link>
        <nav aria-label={NAV.menu} className="flex flex-wrap gap-3 text-meta">
          <Link href="/replies/library" className="text-ink-soft hover:text-ink">
            {NAV.library}
          </Link>
          <Link href="/replies/resources" className="text-ink-soft hover:text-ink">
            {NAV.resources}
          </Link>
          <Link href="/replies/facts" className="text-ink-soft hover:text-ink">
            {NAV.facts}
          </Link>
          <Link href="/replies/settings" className="text-ink-soft hover:text-ink">
            {NAV.settings}
          </Link>
        </nav>
      </div>

      <div className="mx-auto mt-2 flex max-w-[1100px] flex-wrap gap-x-4 gap-y-1">
        <span className="text-meta text-ink-soft">{PROGRESS.label}</span>
        {platforms.map((platform) => (
          <span key={platform} className="sr-tnum text-meta text-ink">
            {PROGRESS.forPlatform(
              PLATFORM_LABELS[platform],
              progress?.counts[platform] ?? 0,
              progress?.targets[platform] ?? 10,
            )}
          </span>
        ))}
      </div>
    </header>
  );
}
