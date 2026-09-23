import type { Language, Platform } from './enums';
import { C_LIGHT, formatVisualVersion, type VisualBrief } from './visual';

/**
 * Deterministic SOAR v1.1 C-light renderer (CS-012, VIS-03).
 *
 * Pure and isomorphic: the same brief and options always give byte-identical SVG,
 * in Node and in the browser. It is a deterministic approximation of the C-light
 * notebook style (paper, ink, one yellow focal marker, sparse green connectors),
 * not hand-drawn art.
 *
 * Rules it enforces:
 * - only the locked palette plus white box fills and one soft ink for the caveat;
 * - exactly one yellow rectangle, behind the focal phrase only;
 * - text never below 44 px at 1080 wide (the caveat is the one small line);
 * - the exact line-broken copy: every `\n` is a line break and copy lines are never
 *   re-wrapped. When a line cannot fit at the 44 px floor the result carries a
 *   problem instead of silently clipping or re-flowing;
 * - main-idea labels inside the diagram wrap only at spaces (per character for
 *   CJK) and honour their own `\n`;
 * - no external fonts, images, links or scripts: text is XML-escaped and the font
 *   is a system font stack.
 *
 * Text widths are estimated from a fixed per-character table (fonts are not
 * available to a pure function). Every text run carries `textLength`, so the
 * browser fits the glyphs to the estimated width: the focal marker lines up with
 * its phrase and nothing runs past the margin whatever system font is used.
 */

export const INK_SOFT = '#4A5558';
export const BOX_FILL = '#FFFFFF';
/** Every colour the renderer may emit. Tests parse the SVG and assert this subset. */
export const RENDER_PALETTE: readonly string[] = [C_LIGHT.paper, C_LIGHT.ink, C_LIGHT.focal, C_LIGHT.green, BOX_FILL, INK_SOFT];

export const RENDER_WIDTH = 1080;
export const MIN_TEXT_PX = 44;
export const CAVEAT_PX = 32;
const MARGIN = 96;
const CONTENT_W = RENDER_WIDTH - 2 * MARGIN;
const COPY_LEADING = 1.22;
const IDEA_LEADING = 1.25;
const BOX_PAD = 28;

export type RenderProblemCode =
  | 'copy_overflow'
  | 'copy_too_tall'
  | 'focal_missing'
  | 'focal_multiline'
  | 'idea_overflow'
  | 'diagram_too_tall'
  | 'caveat_overflow';

export type RenderProblem = { code: RenderProblemCode; message: string; line?: number };

export type RenderOptions = {
  language: Language;
  platform: Platform;
  /** 1..999 for a versioned revision; 0 renders an unversioned draft preview. */
  revision: number;
};

export type RenderResult = { svg: string; problems: RenderProblem[]; width: number; height: number };

export function canvasFor(placement: VisualBrief['placement']): { width: number; height: number } {
  return { width: RENDER_WIDTH, height: placement === 'feed-portrait' ? 1350 : 1080 };
}

// ------------------------------------------------------------------ measuring

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

const NARROW = new Set([...'iljtfrI|!.,:;\'`()[]']);
const BROAD = new Set([...'mwMW@%']);

/** Width of one character in em. Deliberately generous so real glyphs fit. */
function charEm(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (isWide(cp)) return 1.0;
  if (ch === ' ') return 0.28;
  if (NARROW.has(ch)) return 0.3;
  if (BROAD.has(ch)) return 0.84;
  if (ch >= 'A' && ch <= 'Z') return 0.64;
  if (ch >= '0' && ch <= '9') return 0.56;
  if (ch >= 'a' && ch <= 'z') return 0.52;
  return 0.6;
}

export function estimateTextWidth(text: string, sizePx: number, bold = false): number {
  let em = 0;
  for (const ch of Array.from(text)) em += charEm(ch);
  return em * sizePx * (bold ? 1.08 : 1);
}

/** One decimal place, no trailing `.0`: stable number formatting for byte-identical output. */
function n(x: number): string {
  const r = Math.round(x * 10) / 10;
  return Object.is(r, -0) ? '0' : String(r);
}

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Drop characters XML 1.0 cannot carry (control characters, lone surrogates). */
function xmlSafe(text: string): string {
  let out = '';
  for (const ch of Array.from(text)) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x9 || cp === 0xa || cp === 0xd || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || cp >= 0x10000) out += ch;
  }
  return out;
}

// ------------------------------------------------------------------ wrapping (ideas and caveat only)

type Wrapped = { lines: string[]; overflow: boolean };

/** Break opportunities at spaces and between wide (CJK) characters. Explicit `\n` always breaks. */
function wrap(text: string, maxWidth: number, sizePx: number, bold: boolean): Wrapped {
  const out: string[] = [];
  let overflow = false;
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    const tokens: string[] = [];
    let word = '';
    for (const ch of Array.from(paragraph)) {
      const cp = ch.codePointAt(0) ?? 0;
      if (ch === ' ') {
        if (word) tokens.push(word);
        word = '';
        tokens.push(' ');
      } else if (isWide(cp)) {
        if (word) tokens.push(word);
        word = '';
        tokens.push(ch);
      } else {
        word += ch;
      }
    }
    if (word) tokens.push(word);
    let line = '';
    for (const token of tokens) {
      const candidate = line + token;
      if (line !== '' && estimateTextWidth(candidate.trimEnd(), sizePx, bold) > maxWidth) {
        out.push(line.trimEnd());
        line = token === ' ' ? '' : token;
      } else {
        line = candidate;
      }
      if (estimateTextWidth(line.trim(), sizePx, bold) > maxWidth) overflow = true;
    }
    out.push(line.trim());
  }
  return { lines: out, overflow };
}

// ------------------------------------------------------------------ drawing helpers

type Box = { x: number; y: number; w: number; h: number };

const FONT_EN = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', 'Noto Sans TC', 'PingFang TC', sans-serif";
const FONT_ZH = "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', ui-sans-serif, system-ui, sans-serif";

function textRun(text: string, x: number, baseline: number, size: number, opts: { bold?: boolean; fill?: string; italic?: boolean } = {}): string {
  const content = xmlSafe(text);
  if (content.trim() === '') return '';
  const width = estimateTextWidth(content, size, opts.bold);
  return (
    `<text x="${n(x)}" y="${n(baseline)}" font-size="${n(size)}"` +
    `${opts.bold ? ' font-weight="700"' : ''}${opts.italic ? ' font-style="italic"' : ''}` +
    ` fill="${opts.fill ?? C_LIGHT.ink}" textLength="${n(width)}" lengthAdjust="spacing">${escapeXml(content)}</text>`
  );
}

function boxRect(b: Box): string {
  return `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" rx="18" fill="${BOX_FILL}" stroke="${C_LIGHT.ink}" stroke-width="3" stroke-linejoin="round"/>`;
}

/** A restrained connector: a slightly bowed line, round caps, optional arrowhead. */
function connector(x1: number, y1: number, x2: number, y2: number, arrow: boolean): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.max(1, Math.hypot(dx, dy));
  // Bow perpendicular to the line by a small fixed amount: a hand-drawn hint, not a flourish.
  const bow = Math.min(10, len / 8);
  const cx = mx - (dy / len) * bow;
  const cy = my + (dx / len) * bow;
  let out = `<path d="M${n(x1)} ${n(y1)} Q${n(cx)} ${n(cy)} ${n(x2)} ${n(y2)}" fill="none" stroke="${C_LIGHT.green}" stroke-width="4" stroke-linecap="round"/>`;
  if (arrow) {
    const ux = (x2 - cx) / Math.max(1, Math.hypot(x2 - cx, y2 - cy));
    const uy = (y2 - cy) / Math.max(1, Math.hypot(x2 - cx, y2 - cy));
    const size = 16;
    const ax = x2 - ux * size - uy * size * 0.6;
    const ay = y2 - uy * size + ux * size * 0.6;
    const bx = x2 - ux * size + uy * size * 0.6;
    const by = y2 - uy * size - ux * size * 0.6;
    out += `<path d="M${n(ax)} ${n(ay)} L${n(x2)} ${n(y2)} L${n(bx)} ${n(by)}" fill="none" stroke="${C_LIGHT.green}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return out;
}

// ------------------------------------------------------------------ copy block

type CopyLayout = { size: number; height: number; lines: string[]; problems: RenderProblem[] };

function layoutCopy(copy: string, maxWidth: number, maxHeight: number, sizes: number[]): CopyLayout {
  const lines = copy.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/u, ''));
  for (const size of sizes) {
    const fitsWidth = lines.every((l) => estimateTextWidth(l, size, true) <= maxWidth);
    const height = lines.length * size * COPY_LEADING;
    if (fitsWidth && height <= maxHeight) return { size, height, lines, problems: [] };
  }
  const floor = MIN_TEXT_PX;
  const problems: RenderProblem[] = [];
  lines.forEach((l, i) => {
    if (estimateTextWidth(l, floor, true) > maxWidth) {
      problems.push({
        code: 'copy_overflow',
        line: i + 1,
        message: `Copy line ${i + 1} is too long to fit at the smallest allowed size (${floor} px). Shorten it or add a line break yourself.`,
      });
    }
  });
  const height = lines.length * floor * COPY_LEADING;
  if (height > maxHeight) {
    problems.push({ code: 'copy_too_tall', message: `The copy has too many lines for this placement at ${floor} px. Cut lines or choose a portrait placement.` });
  }
  return { size: floor, height, lines, problems };
}

function drawCopy(layout: CopyLayout, focal: string, x: number, top: number, width: number, centred: boolean): { svg: string; problems: RenderProblem[] } {
  const { size, lines } = layout;
  const problems: RenderProblem[] = [];
  let marker = '';
  let text = '';
  let focalLine = -1;
  if (focal.includes('\n')) {
    problems.push({ code: 'focal_multiline', message: 'The focal phrase must sit on one line so it gets one highlight.' });
  } else if (focal.trim() !== '') {
    focalLine = lines.findIndex((l) => l.includes(focal));
    if (focalLine < 0) problems.push({ code: 'focal_missing', message: 'The focal phrase does not appear on any copy line.' });
  }
  lines.forEach((line, i) => {
    const lineTop = top + i * size * COPY_LEADING;
    const baseline = lineTop + size * 0.92;
    const lineWidth = estimateTextWidth(line, size, true);
    const x0 = centred ? x + (width - lineWidth) / 2 : x;
    if (i === focalLine) {
      const at = line.indexOf(focal);
      const pre = line.slice(0, at);
      const post = line.slice(at + focal.length);
      const preW = estimateTextWidth(pre, size, true);
      const focalW = estimateTextWidth(focal, size, true);
      const postLead = post.length - post.trimStart().length;
      const postLeadW = estimateTextWidth(post.slice(0, postLead), size, true);
      const pad = size * 0.14;
      marker = `<rect x="${n(x0 + preW - pad)}" y="${n(lineTop + size * 0.14)}" width="${n(focalW + 2 * pad)}" height="${n(size * 0.98)}" rx="6" fill="${C_LIGHT.focal}"/>`;
      text += textRun(pre.trimEnd(), x0, baseline, size, { bold: true });
      text += textRun(focal, x0 + preW, baseline, size, { bold: true });
      text += textRun(post.trimStart(), x0 + preW + focalW + postLeadW, baseline, size, { bold: true });
    } else {
      text += textRun(line, x0, baseline, size, { bold: true });
    }
  });
  // The marker is drawn first so the ink sits on top of it.
  return { svg: marker + text, problems };
}

// ------------------------------------------------------------------ diagram grammars

type IdeaBlock = { lines: string[]; height: number };

function ideaBlock(text: string, width: number, size: number): { block: IdeaBlock; overflow: boolean } {
  const w = wrap(text, width, size, false);
  return { block: { lines: w.lines, height: w.lines.length * size * IDEA_LEADING }, overflow: w.overflow };
}

function drawIdea(block: IdeaBlock, x: number, top: number, width: number, size: number, centred: boolean): string {
  let out = '';
  block.lines.forEach((line, i) => {
    const baseline = top + i * size * IDEA_LEADING + size * 0.92;
    const lw = estimateTextWidth(line, size, false);
    out += textRun(line, centred ? x + (width - lw) / 2 : x, baseline, size);
  });
  return out;
}

type Diagram = { svg: string; height: number; overflowIdeas: number[] };

/** Every grammar is drawn from its top edge at `top`; the caller centres it vertically. */
function diagram(grammar: VisualBrief['grammar'], ideas: string[], x: number, width: number, size: number): (top: number) => Diagram {
  const overflowIdeas: number[] = [];
  const blocks = (w: number) =>
    ideas.map((idea, i) => {
      const r = ideaBlock(idea, w, size);
      if (r.overflow) overflowIdeas.push(i + 1);
      return r.block;
    });

  switch (grammar) {
    case 'list': {
      const marker = 40;
      const textX = x + marker * 2 + 32;
      const bs = blocks(width - (textX - x));
      const gap = 44;
      const heights = bs.map((b) => Math.max(b.height, marker * 2));
      const height = heights.reduce((a, b) => a + b, 0) + gap * (bs.length - 1);
      return (top) => {
        let y = top;
        let svg = '';
        bs.forEach((b, i) => {
          const cy = y + marker;
          svg += `<circle cx="${n(x + marker)}" cy="${n(cy)}" r="${n(marker - 2)}" fill="${C_LIGHT.paper}" stroke="${C_LIGHT.ink}" stroke-width="3"/>`;
          const num = String(i + 1);
          svg += textRun(num, x + marker - estimateTextWidth(num, MIN_TEXT_PX, true) / 2, cy + MIN_TEXT_PX * 0.36, MIN_TEXT_PX, { bold: true });
          svg += drawIdea(b, textX, y + Math.max(0, (marker * 2 - b.height) / 2), width - (textX - x), size, false);
          y += heights[i]! + gap;
        });
        return { svg, height, overflowIdeas };
      };
    }
    case 'contrast': {
      const gutter = 96;
      const colW = (width - gutter) / 2;
      const [a = '', b = '', ...rest] = ideas;
      const pair = [a, b].map((idea, i) => {
        const r = ideaBlock(idea, colW - 2 * BOX_PAD, size);
        if (r.overflow) overflowIdeas.push(i + 1);
        return r.block;
      });
      const restBlocks = rest.map((idea, i) => {
        const r = ideaBlock(idea, width, size);
        if (r.overflow) overflowIdeas.push(i + 3);
        return r.block;
      });
      const boxH = Math.max(pair[0]!.height, pair[1]!.height) + 2 * BOX_PAD;
      const restGap = 48;
      const restH = restBlocks.reduce((s, r) => s + r.height, 0) + (restBlocks.length ? restGap + 24 * (restBlocks.length - 1) : 0);
      const height = boxH + restH;
      return (top) => {
        let svg = '';
        pair.forEach((blk, i) => {
          const bx = x + i * (colW + gutter);
          svg += boxRect({ x: bx, y: top, w: colW, h: boxH });
          svg += drawIdea(blk, bx + BOX_PAD, top + BOX_PAD + (boxH - 2 * BOX_PAD - blk.height) / 2, colW - 2 * BOX_PAD, size, false);
        });
        const cy = top + boxH / 2;
        svg += connector(x + colW + 14, cy, x + colW + gutter - 14, cy, false);
        let y = top + boxH + restGap;
        restBlocks.forEach((blk) => {
          svg += drawIdea(blk, x, y, width, size, false);
          y += blk.height + 24;
        });
        return { svg, height, overflowIdeas };
      };
    }
    case 'flow': {
      const bs = blocks(width - 2 * BOX_PAD);
      const gap = 72;
      const heights = bs.map((b) => b.height + 2 * BOX_PAD);
      const height = heights.reduce((a, b) => a + b, 0) + gap * (bs.length - 1);
      return (top) => {
        let y = top;
        let svg = '';
        bs.forEach((b, i) => {
          svg += boxRect({ x, y, w: width, h: heights[i]! });
          svg += drawIdea(b, x + BOX_PAD, y + BOX_PAD, width - 2 * BOX_PAD, size, false);
          const bottom = y + heights[i]!;
          if (i < bs.length - 1) svg += connector(x + width / 2, bottom + 10, x + width / 2, bottom + gap - 10, true);
          y = bottom + gap;
        });
        return { svg, height, overflowIdeas };
      };
    }
    case 'matrix': {
      const cellW = width / 2;
      const bs = blocks(cellW - 2 * BOX_PAD);
      const rows = Math.ceil(bs.length / 2);
      const rowH = Array.from({ length: rows }, (_, r) => Math.max(bs[r * 2]?.height ?? 0, bs[r * 2 + 1]?.height ?? 0) + 2 * BOX_PAD);
      const height = rowH.reduce((a, b) => a + b, 0);
      return (top) => {
        let svg = boxRect({ x, y: top, w: width, h: height });
        svg += `<path d="M${n(x + cellW)} ${n(top)} L${n(x + cellW)} ${n(top + height)}" fill="none" stroke="${C_LIGHT.ink}" stroke-width="3" stroke-linecap="round"/>`;
        let y = top;
        for (let r = 0; r < rows; r += 1) {
          if (r > 0) svg += `<path d="M${n(x)} ${n(y)} L${n(x + width)} ${n(y)}" fill="none" stroke="${C_LIGHT.ink}" stroke-width="3" stroke-linecap="round"/>`;
          for (let c = 0; c < 2; c += 1) {
            const blk = bs[r * 2 + c];
            if (blk) svg += drawIdea(blk, x + c * cellW + BOX_PAD, y + BOX_PAD, cellW - 2 * BOX_PAD, size, false);
          }
          y += rowH[r]!;
        }
        return { svg, height, overflowIdeas };
      };
    }
    case 'single-idea':
    default: {
      const bs = blocks(width);
      const rule = 40;
      const gap = 20;
      const height = rule + bs.reduce((a, b) => a + b.height, 0) + gap * Math.max(0, bs.length - 1);
      return (top) => {
        let svg = `<path d="M${n(x + width / 2 - 60)} ${n(top + 6)} L${n(x + width / 2 + 60)} ${n(top + 6)}" fill="none" stroke="${C_LIGHT.green}" stroke-width="4" stroke-linecap="round"/>`;
        let y = top + rule;
        bs.forEach((b) => {
          svg += drawIdea(b, x, y, width, size, true);
          y += b.height + gap;
        });
        return { svg, height, overflowIdeas };
      };
    }
  }
}

// ------------------------------------------------------------------ render

const COPY_SIZES = [76, 68, 60, 52, 44];
const HERO_SIZES = [96, 88, 80, 72, 64, 56, 48, 44];
const IDEA_SIZES = [52, 48, 44];

export function renderBriefSvg(brief: VisualBrief, opts: RenderOptions): RenderResult {
  const { width, height } = canvasFor(brief.placement);
  const problems: RenderProblem[] = [];
  const centred = brief.grammar === 'single-idea';
  const ideas = brief.mainIdeas.map((i) => i.trim()).filter((i) => i !== '');

  // Caveat: small soft line at the foot, at most two lines.
  const caveatText = (brief.caveat ?? '').trim();
  let caveatSvg = '';
  let caveatH = 0;
  if (caveatText) {
    const w = wrap(caveatText, CONTENT_W, CAVEAT_PX, false);
    if (w.overflow || w.lines.length > 2) {
      problems.push({ code: 'caveat_overflow', message: 'The caveat is too long. Keep it to two short lines.' });
    }
    const lines = w.lines.slice(0, 2);
    caveatH = lines.length * CAVEAT_PX * 1.3 + 32;
    const top = height - MARGIN - lines.length * CAVEAT_PX * 1.3;
    lines.forEach((line, i) => {
      caveatSvg += textRun(line, MARGIN, top + i * CAVEAT_PX * 1.3 + CAVEAT_PX * 0.92, CAVEAT_PX, { fill: INK_SOFT, italic: true });
    });
  }

  const contentTop = MARGIN;
  const contentBottom = height - MARGIN - caveatH;
  const available = contentBottom - contentTop;
  const copyShare = centred ? 0.6 : 0.42;
  const copy = layoutCopy(brief.lineBrokenCopy, CONTENT_W, available * copyShare, centred ? HERO_SIZES : COPY_SIZES);
  problems.push(...copy.problems);

  const gap = 64;
  const diagramTop = contentTop + copy.height + gap;
  const diagramSpace = contentBottom - diagramTop;

  let chosen: Diagram | null = null;
  for (const size of IDEA_SIZES) {
    const draw = diagram(brief.grammar, ideas, MARGIN, CONTENT_W, size);
    const probe = draw(0);
    if (probe.overflowIdeas.length === 0 && probe.height <= diagramSpace) {
      // Sit a little above centre: closer to the copy it explains, generous space below.
      chosen = draw(diagramTop + (diagramSpace - probe.height) * 0.35);
      break;
    }
  }
  if (!chosen) {
    const draw = diagram(brief.grammar, ideas, MARGIN, CONTENT_W, MIN_TEXT_PX);
    const probe = draw(0);
    chosen = draw(diagramTop + Math.max(0, (diagramSpace - probe.height) * 0.35));
    for (const i of [...new Set(chosen.overflowIdeas)].sort((a, b) => a - b)) {
      problems.push({ code: 'idea_overflow', line: i, message: `Main idea ${i} has a word too long for its box at ${MIN_TEXT_PX} px. Shorten it.` });
    }
    if (chosen.height > diagramSpace) {
      problems.push({ code: 'diagram_too_tall', message: 'The main ideas do not fit below the copy. Shorten them, cut the copy or choose a portrait placement.' });
    }
  }

  const copyDrawn = drawCopy(copy, brief.focalPhrase, MARGIN, contentTop, CONTENT_W, centred);
  problems.push(...copyDrawn.problems);

  const version = opts.revision > 0 ? formatVisualVersion({ system: 'SOAR-v1.1', revision: opts.revision, platform: opts.platform, language: opts.language }) : 'draft';
  const font = opts.language === 'zh-TW' ? FONT_ZH : FONT_EN;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" lang="${opts.language}" data-version="${escapeXml(version)}">` +
    `<title>${escapeXml(xmlSafe(brief.altText.trim()))}</title>` +
    `<desc>${escapeXml(`SOAR-v1.1 C-light ${brief.grammar} ${version}`)}</desc>` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="${C_LIGHT.paper}"/>` +
    `<g font-family="${escapeXml(font)}">` +
    copyDrawn.svg +
    chosen.svg +
    caveatSvg +
    `</g></svg>`;
  return { svg, problems, width, height };
}
