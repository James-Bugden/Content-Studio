import { z } from 'zod';
import { getServices } from '@/application/container';
import { backlogReadiness } from '@/application/backlog-readiness';
import { libraryBacklogView, BACKLOG_SORTS } from '@/domain/library-backlog';
import { PLATFORMS } from '@/domain/enums';
import { AppError } from '@/domain/errors';
import { assertSameOrigin, requireActor } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { timed } from '@/observability/events';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  search: z.string().trim().max(120),
  source: z.string().max(120).optional(),
  platform: z.enum(PLATFORMS).optional(),
  status: z.string().max(60).optional(),
  sort: z.enum(BACKLOG_SORTS).optional(),
  page: z.number().int().min(1).max(250).default(1),
}).strict();

/** Post copy and search terms stay in the same-origin request body, never URLs. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireActor('viewer');
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError('VALIDATION_FAILED');
    const repo = getServices().repo;
    const [library, queue, schedule] = await timed({ name: 'backlog.search', adapter: 'app' }, () => Promise.all([
      repo.listLibrary(), repo.listReadyQueue().catch(() => null), repo.listSchedule().catch(() => null),
    ]));
    const readiness = backlogReadiness(library, queue, schedule);
    // A stale or invented status cannot turn into a silent unfiltered result.
    const view = libraryBacklogView(library, parsed.data, readiness);
    if (parsed.data.status && !view.statusOptions.includes(parsed.data.status)) throw new AppError('VALIDATION_FAILED');
    return json({ ok: true, total: view.total, page: view.page, totalPages: view.totalPages,
      rows: view.rows.map(({ row, value }) => ({ row, value })),
      statuses: Object.fromEntries(view.rows.map((r) => [r.value.libraryId, readiness.get(r.value.libraryId)])),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
