// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ImageSelectionBar } from '@/components/backlog/image-selection-bar';
import { ImageSection } from '@/components/panel/image-section';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/components/guarded-link', () => ({ GuardedLink: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('shows selected count, select-all and the 25-post cap', () => {
  const onAll = vi.fn(), onCheck = vi.fn(), onCreate = vi.fn();
  const props = { count: 2, all: false, busy: false, onAll, onCheck, onCreate };
  const view = render(<ImageSelectionBar {...props} />);
  expect(screen.getByRole('status').textContent).toBe('2 selected');
  fireEvent.click(screen.getByLabelText('Select all on page'));
  expect(onAll).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: 'Check images' })); expect(onCheck).toHaveBeenCalledOnce();
  view.rerender(<ImageSelectionBar {...props} count={26} />);
  expect((screen.getByRole('button', { name: 'Check images' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Select up to 25 posts per run.')).toBeTruthy();
});
it('renders a monospace sketch, requires a revision note and approves before creation', async () => {
  const image = { libraryId: 'SYN-L001', revision: 'a'.repeat(16), sketch: 'Title\n[Task] -> [Evidence]', approval: 'pending', reason: 'A useful sequence.', hasImage: false };
  const actions: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    if (options?.method !== 'POST') return Response.json({ ok: true, image });
    const request = JSON.parse(options.body); actions.push(request.action);
    return Response.json({ ok: true, image: { ...image, revision: 'b'.repeat(16), approval: 'approved', hasImage: request.action === 'create' } });
  }));
  render(<ImageSection libraryId="SYN-L001" canEdit />);
  await screen.findByLabelText('Image sketch');
  expect(screen.getByLabelText('Image sketch').tagName).toBe('PRE');
  expect((screen.getByRole('button', { name: 'Revise sketch' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Revision note'), { target: { value: 'Use two blocks' } });
  expect((screen.getByRole('button', { name: 'Revise sketch' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Approve sketch' }));
  await waitFor(() => expect(actions).toEqual(['approve', 'create']));
  await screen.findByText('Image created. Review it in the image studio.');
});
it('shows monthly limit refusal and preserves the sketch for retry', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => Response.json(options?.method === 'POST' ? { ok: false, code: 'AI_LIMIT_REACHED', message: 'Monthly AI limit reached' }
    : { ok: true, image: { libraryId: 'SYN-L001', revision: 'a'.repeat(16), sketch: 'Title\n[A] -> [B]', approval: 'approved', hasImage: false, reason: 'Approved.' } })));
  render(<ImageSection libraryId="SYN-L001" canEdit />);
  await screen.findByLabelText('Image sketch');
  fireEvent.click(screen.getByRole('button', { name: 'Create image' }));
  await screen.findByText('Monthly AI limit reached');
  expect(screen.getByLabelText('Image sketch').textContent).toContain('[A] -> [B]');
});
