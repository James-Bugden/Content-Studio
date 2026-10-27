// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { PostEditor, type PostEditorHandle } from '@/components/editor/post-editor';
import { resetDirtyStoreForTests } from '@/components/dirty-store';
import type { EditorModel } from '@/domain/views';

const original = 'Old hook\n\nFirst line\nsecond line\nthird line\n\nClosing line';
const model: EditorModel = {
  libraryId: 'SYN-L001', slug: 'Synthetic post', source: 'Synthetic source',
  targetPlatform: 'LinkedIn', reviewStatus: 'Pending', contentProvider: 'db',
  sheet: { revision: 'sheet-1', draft: original, hook: 'Old hook' },
  pesto: '', pestoOptions: [], hookAlternatives: '',
  markdown: { state: 'ok', body: original, sectionHash: 'section-1', fileRevision: '', modifiedTime: '', headingLine: '' },
  mismatch: false, visual: 'Text only',
  gates: { status: 'ready', blockers: [], warnings: [], next: null },
};

const box = () => screen.getByRole('textbox') as HTMLTextAreaElement;
const press = (init: KeyboardEventInit) => fireEvent.keyDown(box(), init);
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  resetDirtyStoreForTests();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('editor undo and redo history (#242)', () => {
  it('types, runs Fewer line breaks, and Ctrl+Z brings the original text back', () => {
    render(<PostEditor model={model} canEdit ns="synthetic" />);
    fireEvent.change(box(), { target: { value: `${original}\nextra` } });
    click('Fewer line breaks');
    expect(box().value).toBe('Old hook\n\nFirst line second line third line Closing line extra');
    press({ key: 'z', ctrlKey: true });
    expect(box().value).toBe(`${original}\nextra`);
    press({ key: 'z', metaKey: true });
    expect(box().value).toBe(original);
    press({ key: 'z', shiftKey: true, ctrlKey: true });
    expect(box().value).toBe(`${original}\nextra`);
    press({ key: 'y', ctrlKey: true });
    expect(box().value).toBe('Old hook\n\nFirst line second line third line Closing line extra');
  });

  it('leaves Ctrl+Z to the browser when there is nothing to undo', () => {
    render(<PostEditor model={model} canEdit ns="synthetic" />);
    const notCancelled = fireEvent.keyDown(box(), { key: 'z', ctrlKey: true });
    expect(notCancelled).toBe(true);
    expect(box().value).toBe(original);
  });

  it('has Undo and Redo buttons that follow the history', () => {
    render(<PostEditor model={model} canEdit ns="synthetic" />);
    const undo = screen.getByRole('button', { name: 'Undo edit' }) as HTMLButtonElement;
    const redo = screen.getByRole('button', { name: 'Redo edit' }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(true);
    click('Fewer line breaks');
    expect(undo.disabled).toBe(false);
    fireEvent.click(undo);
    expect(box().value).toBe(original);
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(false);
    fireEvent.click(redo);
    expect(box().value).not.toBe(original);
  });

  it('puts a hook at the top, marks the draft edited, and undo takes it back', () => {
    const handle = createRef<PostEditorHandle>();
    const pending: (string | null)[] = [];
    render(<PostEditor model={model} canEdit ns="synthetic" handleRef={handle} onPendingHookChange={(h) => pending.push(h)} />);
    expect((screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => handle.current!.applyHook('New hook'));
    expect(box().value).toBe('New hook\n\nFirst line\nsecond line\nthird line\n\nClosing line');
    expect((screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(false);
    expect(pending).toEqual(['New hook']);
    act(() => { press({ key: 'z', ctrlKey: true }); });
    expect(box().value).toBe(original);
    expect(pending).toEqual(['New hook', null]);
    expect((screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves the text and the chosen hook in one request', async () => {
    const handle = createRef<PostEditorHandle>();
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return Response.json({ ok: true, operationId: 'op', replayed: false, steps: [], value: { revision: 'sheet-2', versions: [], deletedAt: null } });
    }));
    const saved: string[] = [];
    render(<PostEditor model={model} canEdit ns="synthetic" handleRef={handle} selection={{ platforms: ['LinkedIn'] }} onHookSaved={(h) => saved.push(h)} />);
    act(() => handle.current!.applyHook('  New hook  '));
    await act(async () => { click('Save draft'); });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ proposed: 'New hook\n\nFirst line\nsecond line\nthird line\n\nClosing line', currentHook: 'New hook', expectedRevision: 'sheet-1' });
    expect(saved).toEqual(['New hook']);
    expect((screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not duplicate a hook that already opens the text', () => {
    const handle = createRef<PostEditorHandle>();
    render(<PostEditor model={model} canEdit ns="synthetic" handleRef={handle} />);
    act(() => handle.current!.applyHook('Old hook'));
    expect(box().value).toBe(original);
  });
});

describe('editor edits keep the caret and scroll (#242)', () => {
  function select(start: number, end: number) {
    box().focus();
    box().setSelectionRange(start, end);
    fireEvent.select(box());
  }

  it('bullets applied to two selected lines keep the selection over those lines and the scroll position', () => {
    render(<PostEditor model={model} canEdit ns="synthetic" />);
    const text = box().value;
    const start = text.indexOf('First line');
    const end = text.indexOf('third line') + 'third line'.length;
    select(start, end);
    box().scrollTop = 120;
    click('Bulleted list');
    const next = box().value;
    expect(next).toBe('Old hook\n\n• First line\n• second line\n• third line\n\nClosing line');
    expect(box().selectionStart).toBe(next.indexOf('• First line'));
    expect(box().selectionEnd).toBe(next.indexOf('• third line') + '• third line'.length);
    expect(box().scrollTop).toBe(120);
    expect(document.activeElement).toBe(box());
  });

  it('Fewer line breaks keeps the caret on the same word and the scroll position', () => {
    render(<PostEditor model={model} canEdit ns="synthetic" />);
    const text = box().value;
    const caret = text.indexOf('third') + 2;
    select(caret, caret);
    box().scrollTop = 80;
    click('Fewer line breaks');
    const next = box().value;
    expect(next.slice(box().selectionStart)).toBe('ird line Closing line');
    expect(box().selectionEnd).toBe(box().selectionStart);
    expect(box().scrollTop).toBe(80);
  });

  it('Undo puts the selection and scroll back where they were', () => {
    render(<PostEditor model={model} canEdit ns="synthetic" />);
    const text = box().value;
    const start = text.indexOf('First line');
    const end = start + 'First line'.length;
    select(start, end);
    click('Bulleted list');
    box().scrollTop = 40;
    click('Undo edit');
    expect(box().value).toBe(text);
    expect(box().selectionStart).toBe(start);
    expect(box().selectionEnd).toBe(end);
    expect(box().scrollTop).toBe(40);
  });
});
