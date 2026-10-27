import { z } from 'zod';
import { fingerprint } from './hash';

export const SAVE_PLATFORMS = ['LinkedIn', 'Threads', 'X'] as const;
export type SavePlatform = (typeof SAVE_PLATFORMS)[number];
export const postVersionSchema = z.object({
  platform: z.enum(SAVE_PLATFORMS),
  english: z.string().max(40_000),
  chinese: z.string().max(40_000).optional(),
  sourceHash: z.string().regex(/^[0-9a-f]{16}$/),
}).strict();
export const postVersionsSchema = z.array(postVersionSchema).max(3).refine(v => new Set(v.map(p => p.platform)).size === v.length);
export type PostVersion = z.infer<typeof postVersionSchema>;
export type PostProperties = { revision: string; versions: PostVersion[]; deletedAt: string | null };
export type PostPropertiesPatch = { versions?: PostVersion[]; draft?: string; deletedAt?: string | null };
export type SaveSelection = { platforms: SavePlatform[]; includeChinese?: boolean; chinese?: { source: string; content: string } };
export const saveSelectionSchema = z.object({ platforms: z.array(z.enum(SAVE_PLATFORMS)).max(3), includeChinese: z.boolean().optional(),
  chinese: z.object({ source: z.string().max(40_000), content: z.string().max(40_000) }).optional() });

export function savedSelection(versions: PostVersion[] | undefined, targetPlatform: string, source?: string): SaveSelection {
  const chinese = versions?.find(v => v.chinese);
  return { platforms: versions?.length ? versions.map(v => v.platform) : [SAVE_PLATFORMS.includes(targetPlatform as SavePlatform) ? targetPlatform as SavePlatform : 'LinkedIn'],
    ...(chinese ? { chinese: { source: source === undefined ? chinese.english : fingerprint(source) === chinese.sourceHash ? source : '', content: chinese.chinese! } } : {}) };
}
