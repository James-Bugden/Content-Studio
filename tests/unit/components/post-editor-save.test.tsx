// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { PostEditor } from '@/components/editor/post-editor';
import { isAnyDirty, resetDirtyStoreForTests } from '@/components/dirty-store';
import type { EditorModel } from '@/domain/views';

const model: EditorModel = {
  libraryId: 'SYN-L001', slug: 'Synthetic post', source: 'Synthetic source',
  targetPlatform: 'LinkedIn', reviewStatus: 'Pending',
  sheet: { revision: 'sheet-1', draft: 'Original synthetic copy', hook: 'Synthetic hook' },
  pesto: '', pestoOptions: [], hookAlternatives: '',
  markdown: {
    state: 'ok', body: 'Original synthetic copy', sectionHash: 'section-1',
    fileRevision: 'drive-1', modifiedTime: '2026-10-24T00:00:00Z', headingLine: '## SYN-L001',
  },
  mismatch: false, visual: 'Text only',
  gates: { status: 'ready', blockers: [], warnings: [], next: null },
};

const success = {
  ok: true, replayed: false, steps: [],
  value: { record: { revision: 'sheet-2' }, sectionHash: 'section-2', driveRevision: 'drive-2' },
};

function pendingSave() {
  let complete!: (body: unknown) => void;
  const response = new Promise<unknown>((resolve) => { complete = resolve; });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(await response)));
  return async (body: unknown) => {
    await act(async () => { complete(body); });
  };
}

beforeEach(() => {
  resetDirtyStoreForTests();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PostEditor save notification (CS-050)', () => {
  it('names database save outcomes in database mode', async () => {
    const complete = pendingSave();
    render(<PostEditor model={{ ...model, contentProvider: 'db' }} canEdit ns="synthetic" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Database synthetic copy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await complete(success);
    expect(screen.getByText('Saved in the database. Drive export is queued.')).toBeTruthy();
  });
  it('does not claim an export was queued for an unchanged database body', async () => {
    const complete = pendingSave();
    render(<PostEditor model={{ ...model, contentProvider: 'db' }} canEdit ns="synthetic" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Synthetic copy already present' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await complete({ ...success, steps: [{ provider: 'db', step: 'update Library', status: 'skipped_already_applied' }] });
    expect(screen.getByText('Already saved in the database.')).toBeTruthy();
  });
  it('confirms a Sheet save with a pending derived copy without leaving the draft dirty', async () => {
    const complete = pendingSave();
    render(<PostEditor model={model} canEdit ns="synthetic" />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Pending synthetic copy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await complete({ ...success, steps: [{ step: 'refresh_pending', provider: 'db', status: 'pending' }] });
    expect(screen.getByText('Saved in the Sheet. Database refresh pending;', { exact: false })).toBeTruthy();
    expect(isAnyDirty()).toBe(false);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Pending synthetic copy');
  });
  it('keeps server-rendered copy read-only until hydration, then permits owner edits', () => {
    const html = document.createElement('div');
    html.innerHTML = renderToString(<PostEditor model={model} canEdit ns="synthetic" />);
    expect(html.querySelector('textarea')?.readOnly).toBe(true);

    const { rerender } = render(<PostEditor model={model} canEdit ns="synthetic" />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(false);
    rerender(<PostEditor model={model} canEdit={false} ns="synthetic" />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(true);
  });

  it('notifies once per save, after the saved copy is committed to the leave guard', async () => {
    const complete = pendingSave();
    const dirtyWhenSaved: boolean[] = [];
    const onSaved = vi.fn(() => { dirtyWhenSaved.push(isAnyDirty()); });
    const { rerender } = render(<PostEditor model={model} canEdit ns="synthetic" onSaved={onSaved} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Saved synthetic copy' } });
    expect(isAnyDirty()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(onSaved).not.toHaveBeenCalled();

    await complete(success);
    expect(dirtyWhenSaved).toEqual([false]);
    expect(screen.getByText('Matches the saved version')).toBeTruthy();

    // A host re-render must not advance again for the same successful save.
    const replacement = vi.fn();
    rerender(<PostEditor model={model} canEdit ns="synthetic" onSaved={replacement} />);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(replacement).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Second synthetic save' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save draft' })); });
    expect(replacement).toHaveBeenCalledTimes(1);
    expect(isAnyDirty()).toBe(false);
  });

  it('keeps the leave guard dirty for text typed while a save is in flight', async () => {
    const complete = pendingSave();
    const dirtyWhenSaved: boolean[] = [];
    render(<PostEditor model={model} canEdit ns="synthetic" onSaved={() => { dirtyWhenSaved.push(isAnyDirty()); }} />);
    const copy = screen.getByRole('textbox');
    fireEvent.change(copy, { target: { value: 'Submitted synthetic copy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    fireEvent.change(copy, { target: { value: 'Newer unsaved synthetic copy' } });

    await complete(success);
    expect(dirtyWhenSaved).toEqual([true]);
    expect(isAnyDirty()).toBe(true);
    expect((copy as HTMLTextAreaElement).value).toBe('Newer unsaved synthetic copy');
  });

  it('never notifies success or clears the dirty guard after a failed save', async () => {
    const complete = pendingSave();
    const onSaved = vi.fn();
    const onSaveFailed = vi.fn();
    render(<PostEditor model={model} canEdit ns="synthetic" onSaved={onSaved} onSaveFailed={onSaveFailed} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Unsaved synthetic copy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await complete({ ok: false, code: 'PROVIDER_UNAVAILABLE' });
    expect(onSaved).not.toHaveBeenCalled();
    expect(onSaveFailed).toHaveBeenCalledTimes(1);
    expect(isAnyDirty()).toBe(true);
  });
});
