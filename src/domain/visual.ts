import type { Language, Platform } from './enums';

/**
 * Visual decisions and SOAR v1.1 revisions (MASTER-SPEC Visual Studio, CS-012).
 *
 * `Visual Source` holds one of: `Text only`, `Original graphic`, or an exact
 * screenshot identifier. Blank means undecided.
 */
export type VisualDecision =
  | { kind: 'undecided' }
  | { kind: 'text_only' }
  | { kind: 'original_graphic' }
  | { kind: 'screenshot'; screenshotId: string }
  | { kind: 'invalid'; raw: string };

const SCREENSHOT_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,119}$/;

export function parseVisualSource(raw: string): VisualDecision {
  const text = raw.trim();
  if (text === '') return { kind: 'undecided' };
  const key = text.toLowerCase().replace(/\s+/g, ' ');
  if (key === 'text only' || key === 'text-only') return { kind: 'text_only' };
  if (key === 'original graphic' || key === 'original') return { kind: 'original_graphic' };
  if (SCREENSHOT_ID.test(text)) return { kind: 'screenshot', screenshotId: text };
  return { kind: 'invalid', raw: text.slice(0, 80) };
}

export function formatVisualSource(decision: VisualDecision): string {
  switch (decision.kind) {
    case 'text_only':
      return 'Text only';
    case 'original_graphic':
      return 'Original graphic';
    case 'screenshot':
      return decision.screenshotId;
    default:
      return '';
  }
}

/** `SOAR-v1.1 / r03 / X / en` */
export type VisualRevision = { system: 'SOAR-v1.1'; revision: number; platform: Platform; language: Language };

const VERSION_RE = /^SOAR-v1\.1\s*\/\s*r(\d{1,3})\s*\/\s*(X|Threads|LinkedIn)\s*\/\s*(en|zh-TW)$/i;

export function parseVisualVersion(raw: string): VisualRevision | null {
  const match = VERSION_RE.exec(raw.trim());
  if (!match) return null;
  const platform = (['X', 'Threads', 'LinkedIn'] as const).find((p) => p.toLowerCase() === match[2]!.toLowerCase())!;
  const language = match[3]!.toLowerCase() === 'en' ? 'en' : 'zh-TW';
  return { system: 'SOAR-v1.1', revision: Number(match[1]), platform, language };
}

export function formatVisualVersion(v: VisualRevision): string {
  return `SOAR-v1.1 / r${String(v.revision).padStart(2, '0')} / ${v.platform} / ${v.language}`;
}

/** Locked C-light palette (Analysis output 3). */
export const C_LIGHT = {
  paper: '#FAFBFC',
  ink: '#172023',
  focal: '#FFE76B',
  green: '#0A3D26',
} as const;

/**
 * Structured brief stored as JSON in the `Image Brief` cell. Keeping it in the
 * existing cell (not a new store) keeps the Sheet authoritative.
 */
export type VisualBrief = {
  lesson: string;
  grammar: 'list' | 'contrast' | 'flow' | 'matrix' | 'single-idea';
  asciiPlan: string;
  mainIdeas: string[];
  lineBrokenCopy: string;
  focalPhrase: string;
  caveat?: string;
  illustrativeReconstruction?: boolean;
  placement: 'feed-square' | 'feed-portrait' | 'inline';
  altText: string;
};

export type BriefProblem = { field: keyof VisualBrief | 'brief'; message: string };

export function validateBrief(brief: Partial<VisualBrief> | null): BriefProblem[] {
  if (!brief) return [{ field: 'brief', message: 'No structured brief yet.' }];
  const problems: BriefProblem[] = [];
  const req: (keyof VisualBrief)[] = ['lesson', 'grammar', 'asciiPlan', 'lineBrokenCopy', 'focalPhrase', 'placement', 'altText'];
  for (const field of req) {
    const value = brief[field];
    if (typeof value !== 'string' || value.trim() === '') problems.push({ field, message: `${field} is required.` });
  }
  const ideas = (brief.mainIdeas ?? []).filter((i) => i.trim() !== '');
  if (ideas.length < 2 || ideas.length > 4) problems.push({ field: 'mainIdeas', message: 'Use 2 to 4 main ideas.' });
  if (brief.focalPhrase && brief.lineBrokenCopy && !brief.lineBrokenCopy.includes(brief.focalPhrase)) {
    problems.push({ field: 'focalPhrase', message: 'The focal phrase must appear in the exact copy.' });
  }
  if (brief.illustrativeReconstruction && !(brief.caveat ?? '').toLowerCase().includes('illustrative')) {
    problems.push({ field: 'caveat', message: 'Illustrative reconstructions need a caveat that says so.' });
  }
  return problems;
}

export function parseBrief(raw: string): Partial<VisualBrief> | null {
  const text = raw.trim();
  if (!text.startsWith('{')) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    const str = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : undefined);
    const grammar = str('grammar');
    const placement = str('placement');
    return {
      lesson: str('lesson'),
      grammar: (['list', 'contrast', 'flow', 'matrix', 'single-idea'] as const).find((g) => g === grammar),
      asciiPlan: str('asciiPlan'),
      mainIdeas: Array.isArray(v.mainIdeas) ? v.mainIdeas.filter((i): i is string => typeof i === 'string').slice(0, 8) : [],
      lineBrokenCopy: str('lineBrokenCopy'),
      focalPhrase: str('focalPhrase'),
      caveat: str('caveat'),
      illustrativeReconstruction: v.illustrativeReconstruction === true,
      placement: (['feed-square', 'feed-portrait', 'inline'] as const).find((p) => p === placement),
      altText: str('altText'),
    };
  } catch {
    return null;
  }
}
