import { getServices } from '@/application/container';
import { loadBoard } from '@/application/board';
import { requireActor } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Board read model (tasks, posts, slots) for client refresh after an action. */
export async function GET(request: Request) {
  try {
    await requireActor('viewer');
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const days = Number(url.searchParams.get('days') ?? '7');
    const board = await loadBoard(getServices().repo, {
      ...(from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? { from } : {}),
      days: Number.isInteger(days) && days >= 1 && days <= 42 ? days : 7,
    });
    return json({ ok: true, board });
  } catch (error) {
    return errorResponse(error);
  }
}
