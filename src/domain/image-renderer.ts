import { z } from 'zod';

export const rendererBriefSchema = z.object({
  format: z.string().regex(/^(?:[ENX]\d{2}|NEW-0[1-5])$/), title: z.string().min(1).max(200),
  fields: z.record(z.string(), z.unknown()), alt_text: z.string().min(1).max(1000),
  platform: z.enum(['linkedin', 'x', 'threads']), language: z.literal('en'), example_label: z.string().max(240).optional(),
}).strict();
export type RendererBrief = z.infer<typeof rendererBriefSchema>;
export type RenderedImage = { png: Uint8Array; sidecar: { sha256: string; tool_version: string; resolved_copy: RendererBrief; [key: string]: unknown } };
export interface ImageRenderer { render(brief: RendererBrief): Promise<RenderedImage> }

export function editorialSidecar(raw: string): { sha256: string; resolved_copy: RendererBrief } | null {
  try { return z.object({ editorial: z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), resolved_copy: rendererBriefSchema }) }).parse(JSON.parse(raw)).editorial; }
  catch { return null; }
}
