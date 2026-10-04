import { describe, expect, it } from 'vitest';
import { resourceInputSchema } from '@/replies/lib/contracts/api';
import { SITE_GUIDES, missingSiteGuides, siteGuideFields } from '@/replies/lib/resources/site-guides';

describe('site guides as Replies resources (CS-058)', () => {
  it('lists each guide once, with a distinct English path and a Chinese path', () => {
    expect(SITE_GUIDES).toHaveLength(22);
    expect(new Set(SITE_GUIDES.map((g) => g.canonical_path)).size).toBe(22);
    for (const g of SITE_GUIDES) {
      expect(g.canonical_path.startsWith('/')).toBe(true);
      expect(g.zh_tw_path.startsWith('/zh-tw/')).toBe(true);
      expect(g.title_en && g.title_zh_tw && g.description).toBeTruthy();
    }
  });

  it('every guide is a valid owned resource under the same schema the Add form uses', () => {
    for (const g of SITE_GUIDES) {
      const parsed = resourceInputSchema.safeParse(siteGuideFields(g));
      expect(parsed.success, g.title_en).toBe(true);
    }
    expect(siteGuideFields(SITE_GUIDES.find((g) => g.title_en === 'Resume Guide')!)).toMatchObject({
      type: 'guide', ownership: 'own', canonical_path: '/resume-guide', zh_tw_path: '/zh-tw/resume-guide', tags: ['guide', 'resume & linkedin'],
    });
  });

  it('a re-run adds only the guides that are not there yet, matched by English path', () => {
    expect(missingSiteGuides([])).toHaveLength(22);
    expect(missingSiteGuides([{ canonical_path: '/resume-guide' }, { canonical_path: null }, { canonical_path: '/not-a-site-guide' }])).toHaveLength(21);
    expect(missingSiteGuides(SITE_GUIDES.map((g) => ({ canonical_path: g.canonical_path })))).toEqual([]);
  });
});
