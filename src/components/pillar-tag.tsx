/**
 * Shared PESTO/content-pillar tag. The text always remains visible, so the
 * category is never conveyed by colour alone. Sheet values are deliberately
 * tolerant: canonical names, legacy short names and one-letter PESTO values all
 * resolve to the same deterministic palette; unknown values stay neutral.
 */
export type PillarTone = 'personal' | 'expertise' | 'social' | 'trending' | 'opinions' | 'build' | 'neutral';

const TONE_CLASS: Record<PillarTone, string> = {
  personal: 'border-pillar-personal/30 bg-pillar-personal-soft text-pillar-personal',
  expertise: 'border-pillar-expertise/30 bg-pillar-expertise-soft text-pillar-expertise',
  social: 'border-pillar-social/30 bg-pillar-social-soft text-pillar-social',
  trending: 'border-pillar-trending/30 bg-pillar-trending-soft text-pillar-trending',
  opinions: 'border-pillar-opinions/30 bg-pillar-opinions-soft text-pillar-opinions',
  build: 'border-pillar-build/30 bg-pillar-build-soft text-pillar-build',
  neutral: 'border-line bg-paper text-ink-soft',
};

export function pillarTone(value: string): PillarTone {
  const key = value.trim().toLocaleLowerCase('en-GB');
  if (!key) return 'neutral';
  if (key === 'p' || key === 'story' || key.startsWith('personal')) return 'personal';
  if (key === 'e' || key.startsWith('expertise')) return 'expertise';
  if (key === 's' || key.startsWith('social proof')) return 'social';
  if (key === 't' || key.startsWith('trending')) return 'trending';
  if (key === 'o' || key.startsWith('opinion')) return 'opinions';
  if (key === 'b' || key.startsWith('build in public')) return 'build';
  return 'neutral';
}

export function PillarTag({ value, emptyLabel = 'No pillar' }: { value: string; emptyLabel?: string }) {
  const tone = pillarTone(value);
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${TONE_CLASS[tone]}`}
      data-pillar-tone={tone}
    >
      <span className="truncate">{value.trim() || emptyLabel}</span>
    </span>
  );
}
