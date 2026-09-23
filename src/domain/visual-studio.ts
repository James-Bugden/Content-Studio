import type { Language, Platform } from './enums';
import type { Gate, ScreenshotUse } from './gates';
import type { VisualApprovalState } from './stage';
import type { BriefProblem, VisualBrief } from './visual';
import type { RenderProblem } from './visual-render';

/**
 * Visual Studio view models and pure helpers (CS-012). Shared by the server
 * services and the client editor, so nothing here touches a provider.
 */

export type DecisionKind = 'undecided' | 'text_only' | 'original_graphic' | 'screenshot' | 'invalid';

export type ReuseState = 'not_applicable' | 'clear' | 'other_platform' | 'same_platform' | 'uncertain';

export type ReuseCheck = { state: ReuseState; uses: ScreenshotUse[]; message: string };

/** VIS-05: same platform blocks; another platform is allowed with a note; an unreadable Schedule is uncertain and blocks. */
export function reuseCheck(platform: Platform | null, uses: ScreenshotUse[] | null): ReuseCheck {
  if (uses === null) {
    return { state: 'uncertain', uses: [], message: 'Content Schedule could not be read, so reuse cannot be ruled out. Retry before using this screenshot.' };
  }
  if (platform === null) {
    return { state: 'uncertain', uses, message: 'The target platform is not recognised, so reuse cannot be checked.' };
  }
  const where = (u: ScreenshotUse) => u.libraryId ?? u.contentId ?? 'another row';
  const same = uses.filter((u) => u.platform === platform);
  if (same.length > 0) {
    return {
      state: 'same_platform',
      uses,
      message: `This screenshot is already used on ${platform} (${same.map(where).join(', ')}). Use Text only or a fresh original graphic.`,
    };
  }
  if (uses.length > 0) {
    const platforms = [...new Set(uses.map((u) => u.platform))].join(', ');
    return { state: 'other_platform', uses, message: `Used before on ${platforms} only, so it can be used once on ${platform}.` };
  }
  return { state: 'clear', uses, message: 'Not used on any platform yet.' };
}

export type VisualItemView = {
  libraryId: string;
  /** Sheet row revision, the expected revision for the next write. */
  revision: string;
  slug: string;
  platform: Platform | null;
  platformLabel: string;
  /** Threads is composed in zh-TW; X and LinkedIn in English. */
  language: Language | null;
  decision: DecisionKind;
  decisionLabel: string;
  screenshotId: string | null;
  imageStatus: string;
  brief: Partial<VisualBrief> | null;
  /** True when `Image Brief` holds text that is not a structured brief. */
  briefUnreadable: boolean;
  briefProblems: BriefProblem[];
  /** Layout problems from rendering the saved brief; empty when there is no complete brief. */
  renderProblems: RenderProblem[];
  altText: string;
  version: string;
  hasFile: boolean;
  /** Short hash of `Image File`. The Drive link itself never reaches the browser. */
  fileHash: string;
  approval: VisualApprovalState;
  /**
   * `current`: the saved brief is exactly what the current revision was rendered
   * from (render stamp or exact approval), so the server preview shows that file.
   * `changed`: the brief, version or file moved on after rendering; no preview.
   * `none`: nothing rendered yet.
   */
  preview: 'current' | 'changed' | 'none';
  /** Hash over the approval material (decision, brief, file, alt text, version). Approval must quote it. */
  material: string;
  reuse: ReuseCheck;
  /** Visual gates only, in priority order, each with its next action in words. */
  gates: Gate[];
  needsAction: boolean;
  reviewable: { ok: true } | { ok: false; reason: string };
  canRender: { ok: true; nextVersion: string } | { ok: false; reason: string };
  imageNextActionIsFormula: boolean;
};

export type VisualList = { items: VisualItemView[]; scheduleUnavailable: boolean };

/** Stable key order, so saving the same brief twice writes the same cell text. */
export function serializeBrief(brief: VisualBrief): string {
  const ordered: VisualBrief = {
    lesson: brief.lesson,
    grammar: brief.grammar,
    asciiPlan: brief.asciiPlan,
    mainIdeas: brief.mainIdeas,
    lineBrokenCopy: brief.lineBrokenCopy,
    focalPhrase: brief.focalPhrase,
    ...(brief.caveat && brief.caveat.trim() !== '' ? { caveat: brief.caveat } : {}),
    ...(brief.illustrativeReconstruction ? { illustrativeReconstruction: true } : {}),
    placement: brief.placement,
    altText: brief.altText,
  };
  return JSON.stringify(ordered);
}

export const GRAMMAR_LABEL: Record<VisualBrief['grammar'], string> = {
  list: 'List (numbered ideas)',
  contrast: 'Contrast (two columns)',
  flow: 'Flow (steps with arrows)',
  matrix: 'Matrix (2 x 2)',
  'single-idea': 'Single idea (centred)',
};

export const PLACEMENT_LABEL: Record<VisualBrief['placement'], string> = {
  'feed-square': 'Feed, square 1080 x 1080',
  'feed-portrait': 'Feed, portrait 1080 x 1350',
  inline: 'Inline, square 1080 x 1080',
};
