import type { ResourceRow } from './types';

/**
 * C06/D06. Resolves the exact URL a resource card or an inserted CTA may show.
 *
 * A wrong answer here is a security defect, not a display one: an owned resource
 * must never resolve outside RESOURCE_BASE_URL's own host, and a malformed or
 * unexpected input must never throw past this module. Every rejection path
 * returns `url: null` with a reason instead of an exception, so a caller cannot
 * forget to catch something and accidentally leak a raw error to a person.
 */

export type ResolvedLocale = 'en' | 'zh-TW';

export interface ResolveResourceUrlOptions {
  locale: ResolvedLocale;
  /** C06: resolved independently of APP_BASE_URL, and may be absent entirely. */
  resourceBaseUrl?: string;
}

export type ResourceUrlReason =
  | 'ok'
  | 'resource_base_url_not_configured'
  | 'no_url_available'
  | 'invalid_url';

export interface ResolvedResourceUrl {
  url: string | null;
  locale: ResolvedLocale;
  /** True only when zh-TW was requested but the English URL was substituted. */
  englishFallback: boolean;
  reason: ResourceUrlReason;
}

type ResolvableResource = Pick<ResourceRow, 'ownership' | 'canonical_path' | 'zh_tw_path' | 'external_url'>;

function unresolved(
  locale: ResolvedLocale,
  englishFallback: boolean,
  reason: ResourceUrlReason,
): ResolvedResourceUrl {
  return { url: null, locale, englishFallback, reason };
}

/**
 * The same shape the database's own check constraints enforce (RES-02), kept
 * here too so this module never has to trust that a caller already went through
 * the schema. A leading double slash is protocol-relative; a backslash anywhere
 * is the ambiguity different URL parsers disagree on; a colon can smuggle a
 * scheme into what looks like a path.
 */
function hasSafeOwnedPathShape(path: string): boolean {
  return /^\/[^/\\]/.test(path) && !path.includes('\\') && !path.includes(':');
}

function resolveOwnedPath(path: string, resourceBaseUrl: string): string | null {
  if (!hasSafeOwnedPathShape(path)) return null;

  let base: URL;
  let resolved: URL;
  try {
    base = new URL(resourceBaseUrl);
    resolved = new URL(path, base);
  } catch {
    return null;
  }

  if (resolved.protocol !== 'https:') return null;
  // Parsed host equality, not a string prefix: a lookalike origin must not pass.
  if (resolved.host !== base.host) return null;
  if (resolved.username || resolved.password) return null;
  return resolved.toString();
}

function resolveExternalUrl(url: string): string | null {
  // Rejected before parsing: a backslash is how one parser and another disagree
  // about where the authority ends, and that disagreement is the whole attack.
  if (url.includes('\\')) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  return parsed.toString();
}

/**
 * `null` is a normal, common answer here: a book with no approved URL, a
 * resource site that has not been configured yet, or an owned page that has no
 * Chinese translation and English was not requested as a fallback destination.
 * None of those is an error state.
 */
export function resolveResourceUrl(
  resource: ResolvableResource,
  options: ResolveResourceUrlOptions,
): ResolvedResourceUrl {
  const { locale } = options;

  if (resource.ownership === 'book') {
    if (!resource.external_url) return unresolved(locale, false, 'no_url_available');
    const url = resolveExternalUrl(resource.external_url);
    return url
      ? { url, locale, englishFallback: false, reason: 'ok' }
      : unresolved(locale, false, 'invalid_url');
  }

  // Owned resource. zh-TW prefers its own page; a missing one falls back to the
  // English page with an explicit flag rather than an invented Chinese path (C06).
  const wantsChinese = locale === 'zh-TW';
  const chinesePath = wantsChinese ? resource.zh_tw_path : null;
  const englishFallback = wantsChinese && !chinesePath;
  const path = chinesePath ?? resource.canonical_path;

  if (!path) return unresolved(locale, englishFallback, 'no_url_available');

  if (!options.resourceBaseUrl) {
    // Not an error: the resource origin genuinely has not been configured, and a
    // guessed jamesbugden.com URL would be a worse answer than an honest null.
    return unresolved(locale, englishFallback, 'resource_base_url_not_configured');
  }

  const url = resolveOwnedPath(path, options.resourceBaseUrl);
  return url
    ? { url, locale, englishFallback, reason: 'ok' }
    : unresolved(locale, englishFallback, 'invalid_url');
}

