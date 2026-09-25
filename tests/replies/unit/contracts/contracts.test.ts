import { describe, it, expect } from 'vitest';
import {
  canonicalProvenance,
  needsEnglishMeaning,
  PLATFORM_LABELS,
} from '@/replies/lib/contracts/vocabulary';
import { contentHash, searchText, payloadFingerprint, codePointLength, containsHan } from '@/replies/lib/contracts/text';
import {
  analyseRequestSchema,
  manualReplyRequestSchema,
  markPostedRequestSchema,
  resourceInputSchema,
  factInputSchema,
  factUpdateSchema,
  resourceUpdateSchema,
  librarySearchRequestSchema,
} from '@/replies/lib/contracts/api';
import { codeForSqlState, statusForCode, isRetryable } from '@/replies/lib/contracts/errors';
import { publicConfig, serverConfig, configurationStatus } from '@/replies/lib/config/env';

describe('vocabulary (C02)', () => {
  it('translates the documented legacy aliases and refuses to guess', () => {
    expect(canonicalProvenance('confirmed_posted')).toBe('posted_confirmed');
    expect(canonicalProvenance('james_edited_unconfirmed')).toBe('user_edited_unconfirmed');
    expect(canonicalProvenance('user_edited')).toBe('user_edited_unconfirmed');
    expect(canonicalProvenance('published_post')).toBe('published_main_post');
    expect(canonicalProvenance('posted_confirmed')).toBe('posted_confirmed');

    // An unrecognised value goes to review. It is never mapped to the nearest match.
    expect(canonicalProvenance('probably_posted')).toBeNull();
    expect(canonicalProvenance('')).toBeNull();
  });

  it('uses full platform names', () => {
    expect(PLATFORM_LABELS).toEqual({ linkedin: 'LinkedIn', x: 'X', threads: 'Threads' });
  });

  it('asks for an English meaning only where the reply is Chinese', () => {
    expect(needsEnglishMeaning('threads')).toBe(true);
    expect(needsEnglishMeaning('linkedin')).toBe(false);
    expect(needsEnglishMeaning('x')).toBe(false);
  });
});

describe('exact text and search text are different things', () => {
  it('normalises only the search copy', () => {
    const exact = '  Hello   WORLD  \r\n\r\n  second  ';
    expect(searchText(exact)).toBe('hello world second');
    // The input is untouched: the function returns a new string.
    expect(exact).toBe('  Hello   WORLD  \r\n\r\n  second  ');
  });

  it('hashes the exact text, so whitespace changes the hash', () => {
    expect(contentHash('reply')).toBe(contentHash('reply'));
    expect(contentHash('reply')).not.toBe(contentHash('reply '));
    expect(contentHash('回覆')).not.toBe(contentHash('回复'));
  });

  it('matches composed and decomposed Chinese in search text but not in the hash', () => {
    const composed = 'é面';
    const decomposed = 'é面'.normalize('NFD');
    expect(searchText(composed)).toBe(searchText(decomposed));
    expect(contentHash(composed)).not.toBe(contentHash(decomposed));
  });

  it('counts an emoji as one character', () => {
    expect(codePointLength('🙂')).toBe(1);
    expect('🙂'.length).toBe(2);
  });

  it('detects Han characters without guessing intent', () => {
    expect(containsHan('謝謝分享')).toBe(true);
    expect(containsHan('thanks for sharing')).toBe(false);
  });
});

describe('payload fingerprint (C09)', () => {
  it('ignores key order so an equivalent payload does not falsely conflict', () => {
    expect(payloadFingerprint({ a: 1, b: 'x' })).toBe(payloadFingerprint({ b: 'x', a: 1 }));
  });

  it('changes when the exact text changes', () => {
    expect(payloadFingerprint({ text: 'a' })).not.toBe(payloadFingerprint({ text: 'a ' }));
  });

  it('distinguishes a missing key from a null one', () => {
    expect(payloadFingerprint({ a: 1 })).not.toBe(payloadFingerprint({ a: 1, b: null }));
  });

  it('is stable across nesting and arrays', () => {
    const one = payloadFingerprint({ list: [{ y: 2, x: 1 }], z: null });
    const two = payloadFingerprint({ z: null, list: [{ x: 1, y: 2 }] });
    expect(one).toBe(two);
  });
});

describe('request validation (C07)', () => {
  it('refuses whitespace-only source text with the copy the design specifies', () => {
    const result = analyseRequestSchema.safeParse({
      request_key: 'k',
      platform: 'linkedin',
      target_kind: 'post',
      source_text: '   \n  ',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Paste the post or comment first.');
  });

  it('counts code points, not UTF-16 units, against the source limit', () => {
    const emojiHeavy = '🙂'.repeat(9_000); // 18,000 UTF-16 units, 9,000 characters
    const result = analyseRequestSchema.safeParse({
      request_key: 'k',
      platform: 'x',
      target_kind: 'post',
      source_text: emojiHeavy,
    });
    expect(result.success).toBe(true);
  });

  it('does not impose a 280-character limit on X', () => {
    const long = 'a'.repeat(1_200);
    const result = markPostedRequestSchema.safeParse({
      session_id: '11111111-1111-4111-8111-111111111111',
      editor_version: 1,
      final_text: long,
    });
    expect(result.success).toBe(true);
  });

  it('keeps a keyword search short', () => {
    const result = analyseRequestSchema.safeParse({
      request_key: 'k',
      platform: 'x',
      target_kind: 'keyword',
      source_text: 'a'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it('refuses a manual reply whose precision and dates disagree', () => {
    const base = { platform: 'x' as const, final_text: 'text' };
    expect(
      manualReplyRequestSchema.safeParse({ ...base, date_precision: 'timestamp' }).success,
    ).toBe(false);
    expect(
      manualReplyRequestSchema.safeParse({ ...base, date_precision: 'date_only' }).success,
    ).toBe(false);
    expect(
      manualReplyRequestSchema.safeParse({
        ...base,
        date_precision: 'unknown',
        posted_date: '2026-01-01',
      }).success,
    ).toBe(false);
    expect(
      manualReplyRequestSchema.safeParse({ ...base, date_precision: 'unknown' }).success,
    ).toBe(true);
  });

  it('keeps library search text out of a URL by requiring a body', () => {
    const parsed = librarySearchRequestSchema.parse({ query: 'interview advice' });
    expect(parsed.limit).toBe(10);
    expect(parsed.include_unknown_dates).toBe(true);
  });

  it('caps a library page at 25', () => {
    expect(librarySearchRequestSchema.safeParse({ query: 'x', limit: 26 }).success).toBe(false);
  });
});

describe('resource and fact inputs (C06)', () => {
  it('refuses an owned resource without a path, and one with an absolute URL', () => {
    expect(
      resourceInputSchema.safeParse({ type: 'guide', ownership: 'own', title_en: 'T' }).success,
    ).toBe(false);
    expect(
      resourceInputSchema.safeParse({
        type: 'guide',
        ownership: 'own',
        title_en: 'T',
        canonical_path: '/g',
        external_url: 'https://example.com/g',
      }).success,
    ).toBe(false);
  });

  it('refuses a book that claims a path on the owner’s own site', () => {
    expect(
      resourceInputSchema.safeParse({
        type: 'book',
        ownership: 'book',
        title_en: 'A book',
        canonical_path: '/books/a',
      }).success,
    ).toBe(false);
  });

  it('defaults a new fact to unapproved and private', () => {
    const fact = factInputSchema.parse({ fact_text: 'I led a hiring project.' });
    expect(fact.approved).toBe(false);
    expect(fact.sensitivity).toBe('private_context_only');
    expect(fact.active).toBe(true);
  });
});

describe('error envelope (C07)', () => {
  it('maps the recording SQLSTATEs onto client codes', () => {
    expect(codeForSqlState('SR401')).toBe('unauthenticated');
    expect(codeForSqlState('SR404')).toBe('not_found');
    expect(codeForSqlState('SR409')).toBe('version_conflict');
    expect(codeForSqlState('23503')).toBe('validation_failed');
    expect(codeForSqlState('42501')).toBe('forbidden');
  });

  it('never leaks an unknown database error as anything but internal', () => {
    expect(codeForSqlState('XX000')).toBe('internal_error');
    expect(codeForSqlState(undefined)).toBe('internal_error');
  });

  it('uses the status codes C07 names', () => {
    expect(statusForCode('validation_failed')).toBe(400);
    expect(statusForCode('unauthenticated')).toBe(401);
    expect(statusForCode('version_conflict')).toBe(409);
    expect(statusForCode('payload_too_large')).toBe(413);
    expect(statusForCode('rate_limited')).toBe(429);
    expect(statusForCode('provider_invalid_response')).toBe(502);
    expect(statusForCode('provider_timeout')).toBe(504);
  });

  it('marks a version conflict as not retryable and a timeout as retryable', () => {
    expect(isRetryable('version_conflict')).toBe(false);
    expect(isRetryable('provider_timeout')).toBe(true);
  });
});

describe('configuration (C10)', () => {
  const blank = {};

  it('reports missing configuration as a state rather than throwing', () => {
    const pub = publicConfig(blank);
    expect(pub.authConfigured).toBe(false);
    expect(pub.timezone).toBe('Asia/Taipei');

    const server = serverConfig(blank);
    expect(server.generation.mode).toBe('unconfigured');
    expect(server.embedding.mode).toBe('unconfigured');
  });

  it('treats a named provider with no key as unconfigured, not as live', () => {
    const server = serverConfig({ AI_PROVIDER: 'anthropic', AI_MODEL: 'claude-sonnet-5' });
    expect(server.generation.mode).toBe('unconfigured');
    expect(server.generation.apiKey).toBeUndefined();
  });

  it('recognises the fake provider without any key', () => {
    const server = serverConfig({ AI_PROVIDER: 'fake' });
    expect(server.generation.mode).toBe('fake');
  });

  it('keeps the resource origin independent of the app origin', () => {
    const server = serverConfig({
      APP_BASE_URL: 'https://replies.example.com',
      RESOURCE_BASE_URL: 'https://guides.example.org/',
    });
    expect(server.resourceBaseUrl).toBe('https://guides.example.org');
  });

  it('reports status without ever returning a secret value', () => {
    const status = configurationStatus({
      AI_PROVIDER: 'anthropic',
      AI_MODEL: 'claude-sonnet-5',
      // Assembled at runtime so this file holds no credential-shaped literal.
      AI_API_KEY: ['sk', 'ant', 'not-a-real-key', '0'.repeat(24)].join('-'),
    });
    expect(status.generation).toBe('live');
    expect(status.generation_model).toBe('claude-sonnet-5');
    expect(JSON.stringify(status)).not.toContain('not-a-real-key');
  });
});

describe('partial updates never reset a field the caller did not mention', () => {
  it('leaves fact fields absent rather than defaulted', () => {
    const parsed = factUpdateSchema.parse({ expected_version: 1, changes: { approved: true } });

    // `.partial()` on a schema with defaults would return sensitivity, tags and
    // active here, and writing that object wholesale would silently reset a fact
    // to private on every unrelated edit.
    expect(Object.keys(parsed.changes)).toEqual(['approved']);
  });

  it('leaves resource fields absent rather than defaulted', () => {
    const parsed = resourceUpdateSchema.parse({ expected_version: 2, changes: { active: false } });

    expect(Object.keys(parsed.changes)).toEqual(['active']);
  });

  it('still validates the fields that are present', () => {
    expect(
      factUpdateSchema.safeParse({ expected_version: 1, changes: { fact_text: '' } }).success,
    ).toBe(false);
    expect(
      resourceUpdateSchema.safeParse({ expected_version: 1, changes: { allowed_platforms: [] } })
        .success,
    ).toBe(false);
  });
});

