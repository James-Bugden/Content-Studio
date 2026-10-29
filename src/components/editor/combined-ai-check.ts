import type { ErrorCode } from '@/domain/errors';
import type { ImageOptionDraft } from '@/domain/image-options';
import type { HookAlternative } from '@/domain/hook-frameworks';
import type { QaProposal } from '@/domain/proposals';
import { postJson, type ApiResult } from '@/lib/client/api';
import { asErrorCode } from './ai-error';

/**
 * The three advisory AI calls behind the single "Check with AI" button (#247):
 * English check, three hook options, image need (with up to 3 sketch options, #248). They run in parallel on the same
 * draft; each part reports on its own as soon as it finishes, and a failure or a
 * spend-cap refusal in one part never hides the others. Each call goes through the
 * AI gateway on the server, so usage is recorded per part against the monthly cap.
 */
export type AiPart = 'qa' | 'hooks' | 'image';
export const AI_PART_LABEL: Record<AiPart, string> = { qa: 'English check', hooks: 'Hook suggestions', image: 'Image check' };
export type ImageVerdict = { verdict: 'needs_image' | 'no_image'; reason: string; /** 1 to 3 ranked ASCII sketch options when an image is needed. */ options: ImageOptionDraft[] };

export type PartResult =
  | { part: 'qa'; ok: true; proposal: QaProposal }
  | { part: 'hooks'; ok: true; alternatives: HookAlternative[] }
  | { part: 'image'; ok: true; image: ImageVerdict }
  | { part: AiPart; ok: false; code: ErrorCode };

type Raw = { ok: true; [key: string]: unknown } | { ok: false; code?: string };
type Post = (url: string, body: unknown, signal?: AbortSignal) => Promise<ApiResult<unknown>>;

export function toPartResult(part: AiPart, res: ApiResult<unknown>): PartResult {
  const body = res.body as Raw;
  if (!body || body.ok !== true) {
    return { part, ok: false, code: res.status === 401 ? 'AUTH_REQUIRED' : asErrorCode((body as { code?: unknown } | null)?.code) };
  }
  if (part === 'qa') return { part, ok: true, proposal: (body as unknown as { proposal: QaProposal }).proposal };
  if (part === 'hooks') return { part, ok: true, alternatives: (body as unknown as { proposal: { alternatives: HookAlternative[] } }).proposal.alternatives.slice(0, 3) };
  const image = body as unknown as Partial<ImageVerdict> & Pick<ImageVerdict, 'verdict' | 'reason'>;
  const options = image.verdict === 'needs_image' && Array.isArray(image.options) ? image.options.slice(0, 3) : [];
  return { part, ok: true, image: { verdict: image.verdict, reason: image.reason, options } };
}

const PATH: Record<AiPart, string> = { qa: 'qa', hooks: 'hooks', image: 'image-need' };

/** Runs all three parts at once; `onPart` fires as each finishes. Rethrows only an abort. */
export async function runCombinedAiCheck(opts: {
  libraryId: string;
  draft: string;
  draftHash: string;
  signal: AbortSignal;
  onPart: (result: PartResult) => void;
  post?: Post;
}): Promise<PartResult[]> {
  const post = opts.post ?? (postJson as Post);
  const base = `/api/library/${encodeURIComponent(opts.libraryId)}`;
  const parts: AiPart[] = ['qa', 'hooks', 'image'];
  return Promise.all(parts.map(async (part) => {
    let result: PartResult;
    try {
      result = toPartResult(part, await post(`${base}/${PATH[part]}`, { draft: opts.draft, draftHash: opts.draftHash }, opts.signal));
    } catch (error) {
      if (opts.signal.aborted || (error as { name?: string }).name === 'AbortError') throw error;
      result = { part, ok: false, code: 'PROVIDER_UNAVAILABLE' };
    }
    if (!opts.signal.aborted) opts.onPart(result);
    return result;
  }));
}

/** The spend cap stops every part at once; report it a single time and keep any other failure. */
export function collapseFailures(failures: { part: AiPart; code: ErrorCode }[]): { part: AiPart; code: ErrorCode }[] {
  let capSeen = false;
  return failures.filter((f) => {
    if (f.code !== 'AI_LIMIT_REACHED') return true;
    if (capSeen) return false;
    capSeen = true;
    return true;
  });
}
