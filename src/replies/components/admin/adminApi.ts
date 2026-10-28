'use client';

import { ApiError } from '@/replies/lib/workspace/client';
import type { ErrorEnvelope } from '@/replies/lib/contracts/errors';
import type { BankImage, BankImageCreateRequest, BankImageSuggestRequest, BankImageSuggestResponse, FactInput, LibraryPatchRequest, LibrarySearchRequest, LibrarySearchResponse, ResourceInput, Settings } from '@/replies/lib/contracts/api';
import type { AdminFact, AdminResource, AdminSettings } from '@/replies/lib/server/store';

/**
 * The admin-side fetch layer for library search/correction, resources, facts and
 * settings (SR-018).
 *
 * This is a sibling of `@/replies/lib/workspace/client`, not an extension of it. That
 * module's `libraryPatch` return type is fixed to `{ ok: true }` for the workspace's
 * own needs, but a correction made here also needs the new revision back so a
 * second correction in the same visit does not have to re-fetch the row. Reusing
 * `ApiError` keeps one error-envelope shape across the whole app.
 */

async function send<T>(path: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    ...(body === undefined
      ? {}
      : body instanceof FormData
        ? { body }
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    let envelope: ErrorEnvelope;
    try {
      envelope = (await response.json()) as ErrorEnvelope;
    } catch {
      envelope = {
        code: 'internal_error',
        message: 'Something went wrong.',
        retryable: true,
        request_id: 'unknown',
      };
    }
    throw new ApiError(response.status, envelope);
  }

  return (await response.json()) as T;
}

export const adminApi = {
  librarySearch: (body: LibrarySearchRequest) => send<LibrarySearchResponse>('/api/replies/library/search', 'POST', body),

  correctReply: (id: string, expectedRevision: number, finalText: string, reason: string) =>
    send<{ ok: true; revision: number }>(`/api/replies/library/${id}`, 'PATCH', {
      action: 'correct',
      expected_revision: expectedRevision,
      final_text: finalText,
      reason,
    } satisfies Extract<LibraryPatchRequest, { action: 'correct' }>),

  setWithdrawn: (id: string, withdrawn: boolean) =>
    send<{ ok: true }>(`/api/replies/library/${id}`, 'PATCH', {
      action: 'withdraw',
      withdrawn,
    } satisfies Extract<LibraryPatchRequest, { action: 'withdraw' }>),

  listResources: () => send<{ resources: AdminResource[] }>('/api/replies/resources', 'GET'),
  addSiteGuides: () => send<{ added: number; already_there: number }>('/api/replies/resources/site-guides', 'POST', {}),
  createResource: (body: ResourceInput) => send<{ id: string; version: number }>('/api/replies/resources', 'POST', body),
  updateResource: (id: string, expectedVersion: number, changes: Record<string, unknown>) =>
    send<{ id: string; version: number }>(`/api/replies/resources/${id}`, 'PATCH', {
      expected_version: expectedVersion,
      changes,
    }),

  listFacts: () => send<{ facts: AdminFact[] }>('/api/replies/facts', 'GET'),
  createFact: (body: FactInput) => send<{ id: string; version: number }>('/api/replies/facts', 'POST', body),
  updateFact: (id: string, expectedVersion: number, changes: Record<string, unknown>) =>
    send<{ id: string; version: number }>(`/api/replies/facts/${id}`, 'PATCH', {
      expected_version: expectedVersion,
      changes,
    }),

  listImages: () => send<{ images: BankImage[] }>('/api/replies/images', 'GET'),
  uploadImage: (form: FormData) => send<{ id: string; version: number; replayed: boolean }>('/api/replies/images', 'POST', form),
  updateImage: (id: string, expectedVersion: number, requestKey: string, changes: Record<string, unknown>) =>
    send<{ id: string; version: number }>(`/api/replies/images/${id}`, 'PATCH', {
      expected_version: expectedVersion,
      request_key: requestKey,
      changes,
    }),
  deleteImage: (id: string, expectedVersion: number, requestKey: string) =>
    send<{ ok: true }>(`/api/replies/images/${id}`, 'DELETE', {
      expected_version: expectedVersion,
      request_key: requestKey,
    }),
  suggestImageMeta: (body: BankImageSuggestRequest) =>
    send<BankImageSuggestResponse>('/api/replies/images/suggest', 'POST', body),
  createImage: (body: BankImageCreateRequest) => send<{ image: BankImage }>('/api/replies/images/create', 'POST', body),

  getSettings: () => send<AdminSettings>('/api/replies/settings', 'GET'),
  saveSettings: (body: Settings) => send<AdminSettings>('/api/replies/settings', 'PATCH', body),
};

