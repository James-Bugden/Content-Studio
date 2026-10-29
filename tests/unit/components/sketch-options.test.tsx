// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ImageSection } from '@/components/panel/image-section';
import type { ImageOption } from '@/domain/image-options';
import type { ImageState } from '@/domain/image-pipeline';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/components/guarded-link', () => ({ GuardedLink: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
// eslint-disable-next-line @next/next/no-img-element -- test double for the transfer image
vi.mock('@/components/image-transfer', () => ({ TransferImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const LAYOUTS = ['steps', 'comparison', 'before_after', 'decision', 'quadrant', 'timeline', 'ladder', 'layers', 'overlap'] as const;
const TITLES = ['Three steps', 'Comparison card', 'Before and after', 'Decision fork', 'Two-by-two', 'Timeline', 'Ladder', 'Layers', 'Overlap'];
const option = (n: number): ImageOption => ({ id: `abcdef0${n}`, title: TITLES[n]!, reason: `Reason ${n}.`, layout: LAYOUTS[n]!, sketch: `Sketch ${n}\n+---+\n| ${n} |\n+---+` });
const state = (count: number, over: Partial<ImageState> = {}): ImageState => ({
  libraryId: 'SYN-L001', revision: 'a'.repeat(16), sketch: option(0).sketch, approval: 'pending', reason: 'A short diagram makes the steps easier to follow.', hasImage: false,
  decision: 'needs_image', options: Array.from({ length: count }, (_, n) => option(n)), ...over,
});

type Sent = { action: string; [key: string]: unknown };
/** A tiny fake of the images API: GET returns the state, POST answers per action. */
function api(initial: ImageState, reply: (request: Sent, current: ImageState) => unknown = () => undefined) {
  let current = initial;
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'POST') return Response.json({ ok: true, image: current });
    const request = JSON.parse(String(init.body)) as Sent;
    sent.push(request);
    const custom = reply(request, current);
    if (custom) {
      const body = custom as { ok: boolean; image?: ImageState };
      if (body.ok && body.image) current = body.image;
      return Response.json(body);
    }
    return Response.json({ ok: false, code: 'VALIDATION_FAILED', message: 'Unexpected action.' });
  }));
  return sent;
}
const chosenState = (over: Partial<ImageState> = {}) => (current: ImageState): ImageState => ({ ...current, revision: 'b'.repeat(16), approval: 'approved', ...over });

describe('sketch option cards (#248)', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it.each([1, 2, 3])('shows %i option(s) as cards with a title, reason, layout, scrollable monospace sketch and Make image', async (count) => {
    api(state(count));
    render(<ImageSection libraryId="SYN-L001" canEdit />);
    const list = await screen.findByRole('list', { name: 'Sketch options' });
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(count);
    expect(screen.getByText('Needs an image')).toBeTruthy();
    expect(screen.getByText(/A short diagram makes the steps easier/)).toBeTruthy();
    cards.forEach((card, n) => {
      expect(within(card).getByRole('heading', { name: TITLES[n]! })).toBeTruthy();
      expect(within(card).getByText(`Reason ${n}.`)).toBeTruthy();
      const pre = within(card).getByLabelText(`Sketch: ${TITLES[n]!}`);
      expect(pre.tagName).toBe('PRE');
      expect(pre.className).toMatch(/font-mono/);
      expect(pre.className).toMatch(/overflow-auto/);
      expect(pre.className).toMatch(/max-w-full/);
      expect(within(card).getByRole('button', { name: `Make image from ${TITLES[n]!}` })).toBeTruthy();
      expect(within(card).getByRole('button', { name: 'Edit sketch' })).toBeTruthy();
    });
    // More options is only offered when the first batch returned options.
    expect(screen.getByRole('button', { name: 'More options' })).toBeTruthy();
  });

  it('chooses the sketch, then renders, in one click; marks the chosen card and shows the image with transfer controls', async () => {
    const sent = api(state(3), (request, current) => {
      if (request.action === 'choose') return { ok: true, image: chosenState({ chosenId: request.optionId as string, sketch: option(1).sketch })(current) };
      if (request.action === 'create') return { ok: true, image: { ...chosenState({ chosenId: 'abcdef01', sketch: option(1).sketch })(current), revision: 'c'.repeat(16), hasImage: true, imageUrl: '/api/library/SYN-L001/asset' } };
    });
    render(<ImageSection libraryId="SYN-L001" canEdit />);
    await screen.findByRole('list', { name: 'Sketch options' });
    fireEvent.click(screen.getByRole('button', { name: 'Make image from Comparison card' }));
    await screen.findByText(/Image made\./);
    expect(sent.map(s => s.action)).toEqual(['choose', 'create']);
    expect(sent[0]).toMatchObject({ optionId: 'abcdef01', expectedRevision: 'a'.repeat(16) });
    expect(sent[0]).not.toHaveProperty('sketch');
    expect(sent[1]).toMatchObject({ expectedRevision: 'b'.repeat(16) });
    const cards = within(screen.getByRole('list', { name: 'Sketch options' })).getAllByRole('listitem');
    expect(cards[1]!.getAttribute('data-chosen')).toBe('true');
    expect(within(cards[1]!).getByText('Chosen')).toBeTruthy();
    expect(cards[0]!.getAttribute('data-chosen')).toBeNull();
    expect(screen.getByAltText('The image made from the chosen sketch').getAttribute('src')).toMatch(/\/api\/library\/SYN-L001\/asset\?v=/);
  });

  it('Edit sketch shows an editable box and Make image then sends the edited text', async () => {
    const sent = api(state(2), (request, current) => request.action === 'choose' ? { ok: true, image: chosenState({ chosenId: request.optionId as string })(current) } : { ok: false, code: 'X', message: 'stop' });
    render(<ImageSection libraryId="SYN-L001" canEdit />);
    const list = await screen.findByRole('list', { name: 'Sketch options' });
    const card = within(list).getAllByRole('listitem')[0]!;
    fireEvent.click(within(card).getByRole('button', { name: 'Edit sketch' }));
    const box = within(card).getByLabelText('Sketch text') as HTMLTextAreaElement;
    expect(box.value).toBe(option(0).sketch);
    fireEvent.change(box, { target: { value: 'My own sketch' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Make image from Three steps' }));
    await waitFor(() => expect(sent.length).toBe(2));
    expect(sent[0]).toMatchObject({ action: 'choose', optionId: 'abcdef00', sketch: 'My own sketch' });
    // Reset puts the original text back.
    fireEvent.click(within(card).getByRole('button', { name: 'Reset sketch' }));
    expect(within(card).getByLabelText('Sketch: Three steps').textContent).toBe(option(0).sketch);
  });

  it('shows a render failure after the sketch was chosen and keeps the options for a retry', async () => {
    api(state(2), (request, current) => request.action === 'choose' ? { ok: true, image: chosenState({ chosenId: request.optionId as string })(current) }
      : { ok: false, code: 'CONFIG_MISSING', message: 'The image renderer is not set up.' });
    render(<ImageSection libraryId="SYN-L001" canEdit />);
    await screen.findByRole('list', { name: 'Sketch options' });
    fireEvent.click(screen.getByRole('button', { name: 'Make image from Three steps' }));
    await screen.findByText('Sketch chosen, but the image was not made. The image renderer is not set up.');
    expect(within(screen.getByRole('list', { name: 'Sketch options' })).getAllByRole('listitem')).toHaveLength(2);
    expect((screen.getByRole('button', { name: 'Make image from Three steps' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the monthly limit refusal as is and does not retry the approved sketch', async () => {
    const sent = api(state(2, { approval: 'approved', chosenId: 'abcdef00' }), () => ({ ok: false, code: 'AI_LIMIT_REACHED', message: 'Monthly AI limit reached' }));
    render(<ImageSection libraryId="SYN-L001" canEdit />);
    await screen.findByRole('list', { name: 'Sketch options' });
    fireEvent.click(screen.getByRole('button', { name: 'Make image from Three steps' }));
    await screen.findByText(/Monthly AI limit reached/);
    // Already approved: only the render was attempted.
    expect(sent.map(s => s.action)).toEqual(['create']);
  });

  it('shows a choose refusal and stops before rendering', async () => {
    const sent = api(state(1), () => ({ ok: false, code: 'STALE_READ', message: 'This post changed. Reload it before trying again.' }));
    render(<ImageSection libraryId="SYN-L001" canEdit />);
    await screen.findByRole('list', { name: 'Sketch options' });
    fireEvent.click(screen.getByRole('button', { name: 'Make image from Three steps' }));
    await screen.findByText('This post changed. Reload it before trying again.');
    expect(sent.map(s => s.action)).toEqual(['choose']);
  });

  it('More options appends below, and says so when nothing more fits', async () => {
    const sent = api(state(2), (request, current) => {
      const more = sent.filter(s => s.action === 'more').length;
      if (request.action !== 'more') return undefined;
      return more === 1 ? { ok: true, image: { ...current, revision: 'd'.repeat(16), options: [...current.options, option(2), option(3)] } }
        : { ok: true, image: current, noMore: true };
    });
    render(<ImageSection libraryId="SYN-L001" canEdit />);
    await screen.findByRole('list', { name: 'Sketch options' });
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    await screen.findByText('2 more options added.');
    const titles = within(screen.getByRole('list', { name: 'Sketch options' })).getAllByRole('heading').map(h => h.textContent);
    expect(titles).toEqual(['Three steps', 'Comparison card', 'Before and after', 'Decision fork']);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    await waitFor(() => expect(screen.getAllByText('No other layout fits this post.').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'More options' })).toBeNull();
    expect(sent.map(s => s.action)).toEqual(['more', 'more']);
  });

  it('stops offering more at nine options', async () => {
    api(state(9));
    render(<ImageSection libraryId="SYN-L001" canEdit />);
    const list = await screen.findByRole('list', { name: 'Sketch options' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(9);
    expect(screen.queryByRole('button', { name: 'More options' })).toBeNull();
    expect(screen.getByText('All 9 options are shown.')).toBeTruthy();
  });

  it('offers no options and no More options when the check returned none', async () => {
    api(state(0, { sketch: '', approval: 'none', decision: 'undecided', reason: '' }));
    render(<ImageSection libraryId="SYN-L001" canEdit />);
    await screen.findByText('No image decision yet.');
    expect(screen.queryByRole('list', { name: 'Sketch options' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More options' })).toBeNull();
  });

  it('with no image needed shows only the verdict and an override that drafts options', async () => {
    const sent = api(state(0, { sketch: '', approval: 'none', decision: 'no_image', reason: 'The point lands as plain text.' }), (request, current) =>
      request.action === 'force' ? { ok: true, image: { ...current, revision: 'e'.repeat(16), decision: 'needs_image', options: [option(0), option(1)], sketch: option(0).sketch, approval: 'pending' } } : undefined);
    render(<ImageSection libraryId="SYN-L001" canEdit />);
    await screen.findByText('No image needed');
    expect(screen.getByText('The point lands as plain text.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Sketch options' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Make image/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Needs an image anyway' }));
    await screen.findByText('Needs an image');
    expect(sent.map(s => s.action)).toEqual(['force']);
    expect(within(screen.getByRole('list', { name: 'Sketch options' })).getAllByRole('listitem')).toHaveLength(2);
  });

  it('reloads when the one-click check saves options while the section is open', async () => {
    let current = state(0, { sketch: '', approval: 'none', decision: 'undecided', reason: '' });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, image: current })));
    render(<ImageSection libraryId="SYN-L001" canEdit />);
    await screen.findByText('No image decision yet.');
    current = state(2);
    act(() => { window.dispatchEvent(new CustomEvent('cs:image-options-saved', { detail: { libraryId: 'SYN-L001' } })); });
    await screen.findByRole('list', { name: 'Sketch options' });
  });

  it('is read-only for a viewer: no actions, but the options can be read', async () => {
    api(state(2));
    render(<ImageSection libraryId="SYN-L001" canEdit={false} />);
    await screen.findByRole('list', { name: 'Sketch options' });
    expect(screen.queryByRole('button', { name: /Make image/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More options' })).toBeNull();
    expect(screen.getByLabelText('Sketch: Three steps')).toBeTruthy();
  });

  it('keeps single-sketch posts (checked before options existed) working', async () => {
    api(state(0, { sketch: 'Title\n[A] -> [B]' }));
    render(<ImageSection libraryId="SYN-L001" canEdit />);
    await screen.findByLabelText('Image sketch');
    expect(screen.getByRole('button', { name: 'Approve sketch' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'More options' })).toBeNull();
  });
});
