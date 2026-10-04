import { pillarTone, type PillarTone } from '../pillar-tag';

/**
 * Options for the PESTO picker (CS-055). The five PESTO stages always appear,
 * spelled the way the Sheet already spells them when it has a value for that
 * stage, so picking one writes the same text the Sheet uses. Any other value
 * already in the Sheet (e.g. "Build in public") is kept as an option too, and the
 * current value is always present so opening the picker never changes it.
 */
const CANONICAL: readonly [PillarTone, string][] = [
  ['personal', 'Personal'],
  ['expertise', 'Expertise'],
  ['social', 'Social proof'],
  ['trending', 'Trending'],
  ['opinions', 'Opinions'],
];

export function pestoChoices(existing: readonly string[], current = ''): string[] {
  const values = [...new Set([...existing, current].map((v) => v.trim()).filter(Boolean))];
  const byTone = new Map<PillarTone, string>();
  for (const v of values) {
    const tone = pillarTone(v);
    // Prefer a full word over a one-letter code for the stage's label.
    if (tone !== 'neutral' && (!byTone.has(tone) || byTone.get(tone)!.length < 2)) byTone.set(tone, v);
  }
  const stages = CANONICAL.map(([tone, label]) => byTone.get(tone) ?? label);
  // Another spelling of a stage already listed (e.g. "O") is dropped unless it is this post's value.
  const others = values
    .filter((v) => !stages.includes(v) && (!CANONICAL.some(([tone]) => tone === pillarTone(v)) || v === current.trim()))
    .sort((a, b) => a.localeCompare(b));
  return [...stages, ...others];
}
