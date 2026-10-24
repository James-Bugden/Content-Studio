import { after } from 'next/server';
import { z } from 'zod';
import { getServices } from '@/application/container';
import { importMarkdownSection, previewMarkdownImport } from '@/application/markdown-import';
import { requireMutation } from '@/lib/auth';
import { errorResponse, json, resultResponse } from '@/lib/http';
import { AppError } from '@/domain/errors';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const actor = await requireMutation(request);
    const input: unknown = await request.json().catch(() => null);
    const { repo, drive, markdownExport } = getServices();
    const preview = z.object({ action: z.literal('preview'), link: z.string().min(1).max(1000) }).strict().safeParse(input);
    if (preview.success) return json({ ok: true, preview: await previewMarkdownImport(repo, drive, actor, preview.data.link) });
    const apply = z.object({ action: z.literal('apply'), section: z.unknown() }).strict().safeParse(input);
    if (!apply.success) throw new AppError('VALIDATION_FAILED');
    const result = await importMarkdownSection(repo, drive, actor, apply.data.section);
    if (result.ok && !('kept' in result) && markdownExport) after(() => markdownExport.run());
    return resultResponse(result);
  } catch (error) { return errorResponse(error); }
}
