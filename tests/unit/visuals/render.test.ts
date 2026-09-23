import { describe, expect, it } from 'vitest';
import { C_LIGHT, parseBrief, type VisualBrief } from '@/domain/visual';
import { MIN_TEXT_PX, RENDER_PALETTE, estimateTextWidth, renderBriefSvg } from '@/domain/visual-render';
import { COMPLETE_BRIEF } from '@/fixtures/synthetic';

/**
 * VIS-03: the deterministic C-light renderer. Synthetic briefs only.
 */
const base = parseBrief(COMPLETE_BRIEF) as VisualBrief;
const en = { language: 'en', platform: 'LinkedIn', revision: 3 } as const;

function colours(svg: string): string[] {
  return [...svg.matchAll(/\b(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]!.toUpperCase());
}

function fontSizes(svg: string): number[] {
  return [...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
}

const GRAMMARS: VisualBrief['grammar'][] = ['list', 'contrast', 'flow', 'matrix', 'single-idea'];

describe('renderBriefSvg', () => {
  it('is byte-identical for the same input, and changes with the revision', () => {
    const a = renderBriefSvg(base, en);
    const b = renderBriefSvg(structuredClone(base), { ...en });
    expect(a.svg).toBe(b.svg);
    expect(a.problems).toEqual([]);
    expect(renderBriefSvg(base, { ...en, revision: 4 }).svg).not.toBe(a.svg);
    expect(a.svg).toContain('data-version="SOAR-v1.1 / r03 / LinkedIn / en"');
  });

  it.each(GRAMMARS)('%s uses only the locked palette, one focal rect and large type', (grammar) => {
    for (const placement of ['feed-square', 'feed-portrait'] as const) {
      const { svg, problems, width, height } = renderBriefSvg({ ...base, grammar, placement }, en);
      expect(problems).toEqual([]);
      expect(width).toBe(1080);
      expect(height).toBe(placement === 'feed-portrait' ? 1350 : 1080);
      const allowed = new Set([...RENDER_PALETTE.map((c) => c.toUpperCase()), 'NONE']);
      expect(colours(svg).filter((c) => !allowed.has(c))).toEqual([]);
      const focalRects = [...svg.matchAll(new RegExp(`<rect[^>]*fill="${C_LIGHT.focal}"`, 'gi'))];
      expect(focalRects).toHaveLength(1);
      expect(svg).toContain(`fill="${C_LIGHT.paper}"`);
      // Everything except the one caveat line is at least 44 px.
      expect(fontSizes(svg).every((s) => s >= MIN_TEXT_PX)).toBe(true);
      expect(svg).not.toMatch(/<(script|image|foreignObject|a)\b|href=|url\(|@import|on[a-z]+=/i);
    }
  });

  it('keeps the exact copy lines and never re-wraps them', () => {
    const { svg } = renderBriefSvg(base, en);
    for (const line of base.lineBrokenCopy.split('\n')) {
      const joined = [...svg.matchAll(/<text[^>]*font-weight="700"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(' ');
      for (const word of line.split(' ')) expect(joined).toContain(word);
    }
    // The focal phrase is one run of its own, sitting on the highlight.
    expect(svg).toContain('>researched range</text>');
  });

  it('escapes markup in copy, ideas, alt text and caveat', () => {
    const hostile: VisualBrief = {
      ...base,
      lineBrokenCopy: 'Do not <script>alert(1)</script>\nthis & that',
      focalPhrase: 'this & that',
      mainIdeas: ['<img src=x onerror=alert(1)>', 'Plain "quoted" idea'],
      altText: '"><svg onload=alert(1)>',
      caveat: 'Illustrative </text><script>x</script>',
    };
    const { svg } = renderBriefSvg(hostile, en);
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('<img');
    expect(svg).not.toContain('<svg onload');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('this &amp; that');
    expect(svg.match(/<svg\b/g)).toHaveLength(1);
  });

  it('reports overflow instead of clipping or re-wrapping a long copy line', () => {
    const long = 'This single copy line is far too long to fit across a square graphic at any readable size at all';
    const { problems, svg } = renderBriefSvg({ ...base, lineBrokenCopy: `${long}\nA researched range`, focalPhrase: 'researched range' }, en);
    expect(problems.map((p) => p.code)).toContain('copy_overflow');
    expect(problems.find((p) => p.code === 'copy_overflow')?.line).toBe(1);
    // The line is still one run: nothing was silently wrapped.
    expect(svg).toContain(`>${long}</text>`);
  });

  it('reports too many copy lines and an overlong idea word', () => {
    const tall = Array.from({ length: 14 }, (_, i) => `Line ${i + 1}`).join('\n');
    expect(renderBriefSvg({ ...base, lineBrokenCopy: `${tall}\nresearched range` }, en).problems.map((p) => p.code)).toContain('copy_too_tall');
    const word = 'Supercalifragilisticexpialidocious-and-then-some';
    expect(renderBriefSvg({ ...base, mainIdeas: [word, 'Short'] }, en).problems.map((p) => p.code)).toContain('idea_overflow');
  });

  it('renders zh-TW copy exactly as given, with a CJK-first font stack and lang', () => {
    const zh: VisualBrief = {
      ...base,
      lineBrokenCopy: '只給一個數字\n會引來還價。\n給有研究的範圍。',
      focalPhrase: '有研究的範圍',
      mainIdeas: ['單一數字引來還價', '範圍代表你做過功課'],
      altText: '兩個方框比較單一薪資數字與有研究的薪資範圍。',
    };
    const { svg, problems } = renderBriefSvg(zh, { language: 'zh-TW', platform: 'Threads', revision: 1 });
    expect(problems).toEqual([]);
    expect(svg).toContain('lang="zh-TW"');
    expect(svg).toContain('>只給一個數字</text>');
    expect(svg).toContain('>有研究的範圍</text>');
    expect(svg).toMatch(/font-family="&#39;Noto Sans TC&#39;/);
    expect(svg).toContain('data-version="SOAR-v1.1 / r01 / Threads / zh-TW"');
  });

  it('shows an illustrative caveat in small soft ink (VIS-06)', () => {
    const { svg, problems } = renderBriefSvg({ ...base, caveat: 'Illustrative reconstruction, not a real offer.', illustrativeReconstruction: true }, en);
    expect(problems).toEqual([]);
    expect(svg).toMatch(/font-size="32"[^>]*font-style="italic" fill="#4A5558"[^>]*>Illustrative reconstruction, not a real offer\.<\/text>/);
  });

  it('flags a focal phrase that spans a line break', () => {
    const { problems, svg } = renderBriefSvg({ ...base, focalPhrase: 'researched range\nshows' }, en);
    expect(problems.map((p) => p.code)).toContain('focal_multiline');
    expect(svg.match(new RegExp(`fill="${C_LIGHT.focal}"`, 'g'))).toBeNull();
  });

  it('estimates CJK characters wider than Latin ones', () => {
    expect(estimateTextWidth('範圍', 44)).toBeGreaterThan(estimateTextWidth('ab', 44));
  });
});
