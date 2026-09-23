import 'server-only';
import type { Actor } from '@/domain/mutation';
import type { EditorModel, ReviewCard } from '@/domain/views';
import type { PostSummary, SlotSummary } from '@/domain/board';
import type { TypefullyDetailView } from '@/domain/typefully-view';
import { shortHash } from '@/domain/hash';
import { AppError } from '@/domain/errors';
import { loadBoard } from './board';
import type { Services } from './container';
import { loadEditor } from './editor';
import { toCard } from './review';
import { loadTypefullyDetail } from './typefully-view';
import { parseContentId } from '@/domain/schedule';

/**
 * Side-panel read models (UX redesign). Everything one panel needs in one
 * request, so a post or a slot can be worked on in place from any page.
 */
export type PostPanelData = {
  model: EditorModel;
  card: ReviewCard;
  summary: PostSummary;
  ns: string;
  canEdit: boolean;
};

export type SlotPanelData = {
  slot: SlotSummary;
  copy: { hook: string; content: string; chineseContent: string; finalContent: string };
  typefully: TypefullyDetailView | null;
  typefullyError: string | null;
  candidates: PostSummary[];
  canEdit: boolean;
};

export async function loadPostPanel(services: Services, actor: Actor, libraryId: string): Promise<PostPanelData> {
  const { repo, drive } = services;
  const [model, library, schedule, board] = await Promise.all([
    loadEditor(repo, drive, libraryId),
    repo.listLibrary(),
    repo.listSchedule().catch(() => null),
    loadBoard(repo),
  ]);
  const record = library.find((r) => r.value.libraryId === libraryId);
  const summary = board.posts.find((p) => p.libraryId === libraryId);
  if (!record || !summary) throw new AppError('NOT_FOUND');
  return {
    model,
    card: toCard(record, library, schedule),
    summary,
    ns: shortHash(`recovery:${actor.sub}:${actor.role}`),
    canEdit: actor.role === 'owner',
  };
}

export async function loadSlotPanel(services: Services, actor: Actor, contentId: string): Promise<SlotPanelData> {
  const parsed = parseContentId(contentId);
  if (!parsed) throw new AppError('VALIDATION_FAILED');
  const { repo, typefully } = services;
  const [board, row] = await Promise.all([loadBoard(repo, { from: parsed.isoDate, days: 1 }), repo.getSchedule(contentId)]);
  const slot = board.slots.find((s) => s.contentId === contentId);
  if (!slot) throw new AppError('NOT_FOUND');
  let detail: TypefullyDetailView | null = null;
  let typefullyError: string | null = null;
  if (!slot.empty) {
    try {
      detail = await loadTypefullyDetail(repo, typefully, contentId);
    } catch (error) {
      typefullyError = (error as { code?: string }).code ?? 'UNKNOWN';
    }
  }
  const candidates = slot.empty && slot.platform !== 'Threads' ? board.posts.filter((p) => p.step.kind === 'schedule' && p.platform === slot.platform) : [];
  const v = row.value;
  return {
    slot,
    copy: { hook: v.hook, content: v.content, chineseContent: v.chineseContent, finalContent: v.finalContent },
    typefully: detail,
    typefullyError,
    candidates,
    canEdit: actor.role === 'owner',
  };
}
