import type { ResolvedLocale } from './resolve';
import type { ResourceRow } from './types';

type CtaResource = Pick<ResourceRow, 'cta_en' | 'cta_zh_tw' | 'title_en' | 'title_zh_tw' | 'access_notes'>;

/**
 * C06/D06. The exact text Add to reply inserts alongside the resolved URL.
 *
 * An approved CTA is the owner's own wording and is used byte-for-byte, never
 * edited or padded. Without one, the generated fallback names only the verified
 * title. It never claims "free", "no signup", a chapter or a promised outcome,
 * because none of those is verified metadata; the one place such a word may
 * legitimately appear is `access_notes`, and even then only because the owner
 * put it there, not because this function invented it.
 */
export function buildCta(resource: CtaResource, locale: ResolvedLocale, url: string | null): string {
  const approved = locale === 'zh-TW' ? resource.cta_zh_tw : resource.cta_en;
  if (approved && approved.trim() !== '') return approved;

  const title = (locale === 'zh-TW' ? resource.title_zh_tw : null) ?? resource.title_en;
  // A resolved link invites a click; no link means this is a recommendation with
  // nothing to open yet (D06's "Add recommendation" case for an unapproved book).
  const lead =
    locale === 'zh-TW'
      ? url
        ? `參考：${title}`
        : `值得參考：${title}`
      : url
        ? `Worth a look: ${title}`
        : `Worth checking out: ${title}`;

  const notes = resource.access_notes?.trim();
  return notes ? `${lead} (${notes})` : lead;
}

