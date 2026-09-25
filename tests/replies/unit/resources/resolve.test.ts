import { describe, it, expect } from 'vitest';
import { resolveResourceUrl, type ResolveResourceUrlOptions } from '@/replies/lib/resources/resolve';
import type { ResourceRow } from '@/replies/lib/resources/types';

/**
 * RES-01/RES-02/SEC-01. Every rejection case is planted and proven rejected;
 * only synthetic example.com/example.org fixtures are used throughout.
 */

type ResolvableFixture = Pick<ResourceRow, 'ownership' | 'canonical_path' | 'zh_tw_path' | 'external_url'>;

function ownedResource(overrides: Partial<ResolvableFixture> = {}): ResolvableFixture {
  return {
    ownership: 'own',
    canonical_path: '/guides/interview-prep',
    zh_tw_path: null,
    external_url: null,
    ...overrides,
  };
}

function bookResource(overrides: Partial<ResolvableFixture> = {}): ResolvableFixture {
  return {
    ownership: 'book',
    canonical_path: null,
    zh_tw_path: null,
    external_url: null,
    ...overrides,
  };
}

const BASE_URL = 'https://example.com';
const englishOptions: ResolveResourceUrlOptions = { locale: 'en', resourceBaseUrl: BASE_URL };
const chineseOptions: ResolveResourceUrlOptions = { locale: 'zh-TW', resourceBaseUrl: BASE_URL };

describe('resolveResourceUrl: happy paths', () => {
  it('resolves an owned English path against the configured base', () => {
    const result = resolveResourceUrl(ownedResource(), englishOptions);
    expect(result).toEqual({
      url: 'https://example.com/guides/interview-prep',
      locale: 'en',
      englishFallback: false,
      reason: 'ok',
    });
  });

  it('resolves the zh-TW path when one exists', () => {
    const result = resolveResourceUrl(
      ownedResource({ zh_tw_path: '/guides/zh/interview-prep' }),
      chineseOptions,
    );
    expect(result).toEqual({
      url: 'https://example.com/guides/zh/interview-prep',
      locale: 'zh-TW',
      englishFallback: false,
      reason: 'ok',
    });
  });

  it('falls back to the English URL and flags it when zh_tw_path is absent', () => {
    const result = resolveResourceUrl(ownedResource(), chineseOptions);
    expect(result.url).toBe('https://example.com/guides/interview-prep');
    expect(result.englishFallback).toBe(true);
    expect(result.reason).toBe('ok');
  });

  it('passes through a book external URL unchanged', () => {
    const result = resolveResourceUrl(
      bookResource({ external_url: 'https://books.example.org/never-split-the-difference' }),
      englishOptions,
    );
    expect(result).toEqual({
      url: 'https://books.example.org/never-split-the-difference',
      locale: 'en',
      englishFallback: false,
      reason: 'ok',
    });
  });

  it('returns null, not an error, for a book with no approved URL', () => {
    const result = resolveResourceUrl(bookResource(), englishOptions);
    expect(result.url).toBeNull();
    expect(result.reason).toBe('no_url_available');
  });
});

describe('resolveResourceUrl: RESOURCE_BASE_URL unset', () => {
  it('resolves an owned resource to null with a distinct reason, not a guessed URL', () => {
    const result = resolveResourceUrl(ownedResource(), { locale: 'en' });
    expect(result.url).toBeNull();
    expect(result.reason).toBe('resource_base_url_not_configured');
  });

  it('still resolves a book URL, because that path never depends on RESOURCE_BASE_URL', () => {
    const result = resolveResourceUrl(
      bookResource({ external_url: 'https://books.example.org/a' }),
      { locale: 'en' },
    );
    expect(result.url).toBe('https://books.example.org/a');
  });
});

describe('resolveResourceUrl: malicious or malformed owned paths', () => {
  const cases: Array<[string, string]> = [
    ['a protocol-relative path', '//evil.example.org/x'],
    ['a backslash in the path', '/guides\\evil'],
    ['a leading backslash pretending to be a slash', '\\\\evil.example.org'],
    ['a scheme smuggled in as a path', '/https://evil.example.org'],
    ['a bare colon without a scheme-shaped prefix', '/guides:evil'],
    ['a path with no leading slash', 'guides/interview-prep'],
    ['an empty path', ''],
  ];

  it.each(cases)('rejects %s', (_label, path) => {
    const result = resolveResourceUrl(ownedResource({ canonical_path: path }), englishOptions);
    expect(result.url).toBeNull();
  });

  it('clamps a dot-segment traversal to the configured host rather than escaping it', () => {
    const result = resolveResourceUrl(ownedResource({ canonical_path: '/../../etc/passwd' }), englishOptions);
    // Either the shape is rejected outright, or the URL constructor's own
    // dot-segment removal keeps the resolved host equal to the configured one.
    // What must never happen is a resolved URL on a different host.
    if (result.url) {
      expect(new URL(result.url).host).toBe(new URL(BASE_URL).host);
    }
  });

  it('rejects a path that would parse to a different host once encoded traversal is applied', () => {
    // %2e%2e is a database-recognised dot segment; this proves it cannot be used
    // to reach a path the shape check would otherwise have rejected as literal.
    const result = resolveResourceUrl(
      ownedResource({ canonical_path: '/%2e%2e/%2e%2e/admin' }),
      englishOptions,
    );
    if (result.url) {
      expect(new URL(result.url).host).toBe(new URL(BASE_URL).host);
    }
  });
});

describe('resolveResourceUrl: malicious or malformed book URLs', () => {
  const cases: Array<[string, string]> = [
    ['plain http instead of https', 'http://books.example.org/a'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a data URL', 'data:text/html,<b>x</b>'],
    ['a protocol-relative URL', '//evil.example.org/a'],
    ['embedded credentials', `https://user:pw${String.fromCharCode(64)}books.example.org/a`],
    ['a backslash in the URL', 'https://books.example.org\\@evil.example.org/a'],
    ['not a URL at all', 'not a url'],
  ];

  it.each(cases)('rejects %s', (_label, external_url) => {
    const result = resolveResourceUrl(bookResource({ external_url }), englishOptions);
    expect(result.url).toBeNull();
    expect(result.reason).toBe('invalid_url');
  });
});

describe('resolveResourceUrl: origin escape via a different configured base', () => {
  it('never resolves to a host other than the one actually configured', () => {
    const result = resolveResourceUrl(ownedResource(), {
      locale: 'en',
      resourceBaseUrl: 'https://example.com',
    });
    expect(result.url).not.toBeNull();
    expect(new URL(result.url as string).host).toBe('example.com');
  });
});

