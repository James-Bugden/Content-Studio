// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { ReviewActions } from '@/components/review/review-actions';
import { FormatToolbar } from '@/components/editor/format-toolbar';
import { PanelImage } from '@/components/visuals/panel-image';
import type { Gate } from '@/domain/gates';
import type { VisualItemView } from '@/domain/visual-studio';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const blocker: Gate = { code: 'VISUAL_UNDECIDED', severity: 'hard', field: 'Visual Source', message: 'Choose an image decision.', nextAction: 'Choose an image', human: true };

it('keeps Request changes available for an approved post with unsaved edits', () => {
  render(<ReviewActions libraryId="SYN-L001" reviewStatus="Approved" blockers={[blocker]} sheetRevision="saved-revision" dirty onDone={vi.fn()} />);
  expect((screen.getByRole('button', { name: 'Request changes' }) as HTMLButtonElement).disabled).toBe(false);
});

it('allows Request changes despite unsaved edits and gates, and uses the saved revision', async () => {
  const onDone = vi.fn();
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ok: true, card: { revision: 'new-revision' } }));
  vi.stubGlobal('fetch', fetcher);
  render(<ReviewActions libraryId="SYN-L001" reviewStatus="Pending" blockers={[blocker]} sheetRevision="saved-revision" dirty onDone={onDone} />);
  expect((screen.getByRole('button', { name: 'Approve only' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('link', { name: 'Choose an image' }).getAttribute('href')).toBe('#panel-image');
  expect(screen.getByRole('button', { name: 'Save before approving' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith({ revision: 'new-revision' }, 'Changes requested.'));
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toMatchObject({ action: 'request_changes', expectedRevision: 'saved-revision' });
});

it('compacts typical post paragraphs, reports the count, then disables the completed action', () => {
  function Demo() {
    const [text, setText] = useState('Hook.\n\nFirst.\n\nSecond.\n\nThird.');
    const ref = useRef<HTMLTextAreaElement>(null);
    return <><textarea ref={ref} value={text} readOnly /><FormatToolbar textarea={ref} text={text} platform="LinkedIn" onChange={setText} /></>;
  }
  render(<Demo />);
  fireEvent.click(screen.getByRole('button', { name: 'Fewer line breaks' }));
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Hook.\n\nFirst. Second. Third.');
  expect(screen.getByRole('status').textContent).toBe('4 fewer line breaks');
  expect((screen.getByRole('button', { name: 'Fewer line breaks' }) as HTMLButtonElement).disabled).toBe(true);
});

const visual = { libraryId: 'SYN-L001', revision: 'a'.repeat(16), decision: 'original_graphic', decisionLabel: 'Original graphic', imageStatus: 'Brief', brief: { lesson: 'Explain the trade-off.', lineBrokenCopy: 'Two options' }, canRender: { ok: true } } as VisualItemView;
it('shows the image judgement, reason, brief, status and guarded actions inline', async () => {
  const onChanged = vi.fn();
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetcher);
  render(<PanelImage initial={visual} canEdit copyDirty={false} onChanged={onChanged} />);
  expect(screen.getByText('Needs an image')).toBeTruthy();
  expect(screen.getByText('Explain the trade-off.')).toBeTruthy();
  expect(screen.getByText(/Two options/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Mark no image' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toMatchObject({ action: 'decide', decision: 'text_only', expectedRevision: visual.revision });
});
