import { z } from 'zod';

/**
 * C02. The single vocabulary.
 *
 * These names are the only ones ever persisted. Legacy aliases are translated at
 * import boundaries and nowhere else, which is why the alias map lives here beside
 * the canonical list rather than inside an adapter where a second adapter could
 * disagree with it.
 */

export const platformSchema = z.enum(['linkedin', 'x', 'threads']);
export type Platform = z.infer<typeof platformSchema>;

export const targetKindSchema = z.enum(['post', 'comment', 'keyword']);
export type TargetKind = z.infer<typeof targetKindSchema>;

export const provenanceSchema = z.enum([
  'posted_confirmed',
  'user_edited_unconfirmed',
  'published_main_post',
  'ai_draft',
]);
export type Provenance = z.infer<typeof provenanceSchema>;

export const publicationEvidenceSchema = z.enum([
  'user_confirmed',
  'platform_export',
  'verified_url',
  'unknown',
]);
export type PublicationEvidence = z.infer<typeof publicationEvidenceSchema>;

export const datePrecisionSchema = z.enum(['timestamp', 'date_only', 'unknown']);
export type DatePrecision = z.infer<typeof datePrecisionSchema>;

export const sectionStateSchema = z.enum(['loading', 'ready', 'empty', 'error']);
export type SectionState = z.infer<typeof sectionStateSchema>;

export const sessionStateSchema = z.enum(['draft', 'recorded', 'discarded']);
export type SessionState = z.infer<typeof sessionStateSchema>;

export const resourceTypeSchema = z.enum(['guide', 'tool', 'article', 'book']);
export type ResourceType = z.infer<typeof resourceTypeSchema>;

export const resourceOwnershipSchema = z.enum(['own', 'book']);
export type ResourceOwnership = z.infer<typeof resourceOwnershipSchema>;

export const factSensitivitySchema = z.enum(['public_safe', 'private_context_only']);
export type FactSensitivity = z.infer<typeof factSensitivitySchema>;

export const importSourceTypeSchema = z.enum(['linkedin', 'x', 'threads', 'drive']);
export type ImportSourceType = z.infer<typeof importSourceTypeSchema>;

export const importDispositionSchema = z.enum([
  'imported',
  'duplicate',
  'needs_review',
  'invalid',
]);
export type ImportDisposition = z.infer<typeof importDispositionSchema>;

/**
 * Import-only legacy aliases. Nothing outside an import adapter may call this,
 * and an unrecognised value is never guessed into a canonical one.
 */
const PROVENANCE_ALIASES: Readonly<Record<string, Provenance>> = Object.freeze({
  confirmed_posted: 'posted_confirmed',
  james_edited_unconfirmed: 'user_edited_unconfirmed',
  user_edited: 'user_edited_unconfirmed',
  published_post: 'published_main_post',
});

/**
 * Returns the canonical provenance for a value that may be a legacy alias, or
 * `null` when the value is unrecognised. A null result means the record goes to
 * private review; it never means "pick the closest match".
 */
export function canonicalProvenance(value: string): Provenance | null {
  const direct = provenanceSchema.safeParse(value);
  if (direct.success) return direct.data;
  return PROVENANCE_ALIASES[value] ?? null;
}

/** Display names. Counters use full platform names, never abbreviations (D02). */
export const PLATFORM_LABELS: Readonly<Record<Platform, string>> = Object.freeze({
  linkedin: 'LinkedIn',
  x: 'X',
  threads: 'Threads',
});

/** The language each platform's reply is authored in (FR-08). */
export const PLATFORM_LANGUAGE: Readonly<Record<Platform, 'en' | 'zh-TW'>> = Object.freeze({
  linkedin: 'en',
  x: 'en',
  threads: 'zh-TW',
});

/** Threads replies are written in Chinese and carry an English review meaning. */
export function needsEnglishMeaning(platform: Platform): boolean {
  return PLATFORM_LANGUAGE[platform] === 'zh-TW';
}

