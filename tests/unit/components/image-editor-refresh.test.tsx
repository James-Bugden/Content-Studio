// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorWorkspace } from '@/components/editor/editor-workspace';
import type { EditorModel } from '@/domain/views';
import { resetDirtyStoreForTests } from '@/components/dirty-store';
import { ToastProvider } from '@/components/toaster';
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const model: EditorModel = { libraryId: 'SYN-L001', slug: 'Synthetic post', source: 'Synthetic', targetPlatform: 'LinkedIn',
  reviewStatus: 'Pending', contentProvider: 'db', sheet: { revision: 'a'.repeat(16), draft: 'Saved draft.', hook: 'A hook' },
  pesto: '', pestoOptions: [], hookAlternatives: '', markdown: { state: 'unavailable', reason: 'no_link', code: 'NOT_FOUND' },
  mismatch: false, visual: 'Text only', gates: { status: 'ready', blockers: [], warnings: [], next: null } };
afterEach(() => { cleanup(); resetDirtyStoreForTests(); vi.unstubAllGlobals(); });
it('reloads a clean editor after an image mutation, preserving a current revision for the next save', async () => {
  const fetcher = vi.fn(async () => Response.json({ ok: true, model: { ...model, sheet: { ...model.sheet, revision: 'b'.repeat(16), draft: 'Latest saved draft.' } } }));
  vi.stubGlobal('fetch', fetcher);
  render(<ToastProvider><EditorWorkspace model={model} canEdit ns="image-refresh" /></ToastProvider>);
  await act(async () => { window.dispatchEvent(new CustomEvent('cs:post-image-changed', { detail: { libraryId: model.libraryId } })); });
  await waitFor(() => expect((screen.getByRole('textbox', { name: /Post copy/ }) as HTMLTextAreaElement).value).toBe('Latest saved draft.'));
  expect(fetcher).toHaveBeenCalledOnce();
});
it('keeps an unsaved draft when an image mutation completes while the owner is typing', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  render(<ToastProvider><EditorWorkspace model={model} canEdit ns="image-refresh-dirty" /></ToastProvider>);
  const copy = screen.getByRole('textbox', { name: /Post copy/ });
  fireEvent.change(copy, { target: { value: 'My unsaved writing.' } });
  await act(async () => { window.dispatchEvent(new CustomEvent('cs:post-image-changed', { detail: { libraryId: model.libraryId } })); });
  expect(fetcher).not.toHaveBeenCalled();
  expect((copy as HTMLTextAreaElement).value).toBe('My unsaved writing.');
});
