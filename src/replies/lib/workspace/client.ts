'use client';

import type {
  AnalyseRequest,
  AnalyseResponse,
  GenerateRequest,
  GenerateResponse,
  MarkPostedRequest,
  MarkPostedResponse,
  MeaningRequest,
  MeaningResponse,
  Progress,
  RefineRequest,
  RefineResponse,
  SessionPatchRequest,
  SessionPatchResponse,
  LibrarySearchRequest,
  LibrarySearchResponse,
  LibraryPatchRequest,
} from '@/replies/lib/contracts/api';
import type { ErrorEnvelope } from '@/replies/lib/contracts/errors';

/**
 * The browser side of the API (C07, SEC-05).
 *
 * Every call is a POST or PATCH with a JSON body, including search. Search text
 * and reply text never appear in a URL, because a URL reaches browser history, the
 * referrer header and any server log along the way, and this app's URLs would
 * otherwise carry the owner's private writing.
 */

export class ApiError extends Error {
  readonly envelope: ErrorEnvelope;
  readonly status: number;

  constructor(status: number, envelope: ErrorEnvelope) {
    super(envelope.message);
    this.name = 'ApiError';
    this.status = status;
    this.envelope = envelope;
  }
}

async function send<T>(path: string, method: 'POST' | 'PATCH' | 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    ...(signal ? { signal } : {}),
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    let envelope: ErrorEnvelope;
    try {
      envelope = (await response.json()) as ErrorEnvelope;
    } catch {
      envelope = {
        code: 'internal_error',
        message: 'Something went wrong. Your text is still here.',
        retryable: true,
        request_id: 'unknown',
      };
    }
    throw new ApiError(response.status, envelope);
  }

  return (await response.json()) as T;
}

export const api = {
  analyse: (body: AnalyseRequest, signal?: AbortSignal) =>
    send<AnalyseResponse>('/api/replies/analyse', 'POST', body, signal),

  generate: (body: GenerateRequest, signal?: AbortSignal) =>
    send<GenerateResponse>('/api/replies/generate', 'POST', body, signal),

  saveDraft: (body: SessionPatchRequest, signal?: AbortSignal) =>
    send<SessionPatchResponse>('/api/replies/session', 'PATCH', body, signal),

  refine: (body: RefineRequest, signal?: AbortSignal) =>
    send<RefineResponse>('/api/replies/refine', 'POST', body, signal),

  meaning: (body: MeaningRequest, signal?: AbortSignal) =>
    send<MeaningResponse>('/api/replies/meaning', 'POST', body, signal),

  markPosted: (body: MarkPostedRequest, idempotencyKey: string) =>
    fetch('/api/replies/mark-posted', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify(body),
    }).then(async (response) => {
      if (!response.ok) {
        const envelope = (await response.json().catch(() => null)) as ErrorEnvelope | null;
        throw new ApiError(
          response.status,
          envelope ?? {
            code: 'internal_error',
            message: "Couldn't save your reply. Your text is still here.",
            retryable: true,
            request_id: 'unknown',
          },
        );
      }
      return (await response.json()) as MarkPostedResponse;
    }),

  saveContentIdea: (body: {
    operationId: string;
    replyId: string;
    platform: 'linkedin' | 'x' | 'threads';
    finalText: string;
  }) =>
    send<{ ok: true; item: { libraryId: string }; replayed: boolean }>(
      '/api/replies/content-idea',
      'POST',
      body,
    ),

  progress: (signal?: AbortSignal) => send<Progress>('/api/replies/progress', 'GET', undefined, signal),

  librarySearch: (body: LibrarySearchRequest, signal?: AbortSignal) =>
    send<LibrarySearchResponse>('/api/replies/library/search', 'POST', body, signal),

  libraryPatch: (id: string, body: LibraryPatchRequest) =>
    send<{ ok: true }>(`/api/replies/library/${id}`, 'PATCH', body),

};

/**
 * A stable operation key for one Mark posted action.
 *
 * It is generated when the owner first presses the button and reused for every
 * retry of that same action, which is what makes a lost response safe to resend.
 * A key derived from the text would change the moment they fixed a typo, and the
 * retry would then record a second reply (C09).
 */
export function newOperationKey(): string {
  return crypto.randomUUID();
}
