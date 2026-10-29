// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AiAssist } from '@/components/editor/ai-assist';
import { DeletePost } from '@/components/editor/delete-post';
import { HookChoice } from '@/components/editor/hook-choice';
import { ToastProvider } from '@/components/toaster';

const refresh = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, replace }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  refresh.mockReset();
  replace.mockReset();
});

const alt = (text: string, total = 8) => ({
  text, framework: 'Curiosity', template: 'Curiosity #3', hookType: 'Curiosity', total,
  scores: { specificity: 2, tension: 2, audienceFit: 2, credibility: 1, valuePromise: 1 },
});

const qaProposal = {
  id: 'qa-1', draftHash: 'x', summary: 'Two small things.',
  findings: [
    { id: 'f1', category: 'spelling', severity: 'must', original: 'teh', replacement: 'the', explanation: 'Typo.', start: 0, end: 3 },
    { id: 'f2', category: 'clarity', severity: 'consider', original: 'a', replacement: null, explanation: 'Vague.', start: 4, end: 5 },
  ],
};

describe('AiAssist (#242, #247)', () => {
  const props = { libraryId: 'SYN-L001', text: 'Synthetic draft', canEdit: true, decided: false, dirty: false, revision: 'rev-1' };

  function route(overrides: Record<string, () => unknown> = {}) {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push({ url, body });
      const key = Object.keys(overrides).find((k) => url.endsWith(k));
      if (key) return Response.json(overrides[key]!());
      if (url.endsWith('/image-need')) return Response.json({ ok: true, verdict: 'no_image', reason: 'The point lands as plain text.', draftHash: 'x', meta: {} });
      if (url.endsWith('/qa')) return Response.json({ ok: true, proposal: qaProposal });
      if (url.endsWith('/hooks')) return Response.json({ ok: true, proposal: { alternatives: [alt('Hook one'), alt('Hook two'), alt('Hook three')] } });
      if (url.endsWith('/visual')) return Response.json({ ok: true, item: { revision: 'rev-2' }, replayed: false });
      throw new Error(`unexpected ${url}`);
    }));
    return calls;
  }

  it('runs the image check and three hooks in one click, records the decision, and offers the hooks', async () => {
    const calls = route();
    const onUseHook = vi.fn();
    const onDecided = vi.fn();
    render(<AiAssist {...props} onUseHook={onUseHook} onDecided={onDecided} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Check with AI/ })); });
    expect(screen.getByText('No image needed')).toBeTruthy();
    expect(screen.getByText(/The point lands as plain text\./)).toBeTruthy();
    expect(screen.getByText(/Recorded as Text only/)).toBeTruthy();
    expect(calls.map((c) => c.url.split('/').pop()).sort()).toEqual(['hooks', 'image-need', 'qa', 'visual']);
    expect(calls.find((c) => c.url.endsWith('/visual'))!.body).toMatchObject({ action: 'decide', decision: 'text_only', expectedRevision: 'rev-1', libraryId: 'SYN-L001' });
    expect(onDecided).toHaveBeenCalledWith('Text only', 'rev-2');
    const options = within(screen.getByRole('list', { name: 'Hook options' })).getAllByRole('listitem');
    expect(options).toHaveLength(3);
    fireEvent.click(within(options[1]!).getByRole('button', { name: /Use hook option 2/ }));
    expect(onUseHook).toHaveBeenCalledWith('Hook two');
  });

  it('maps a needed image to an original graphic decision', async () => {
    const calls = route({ '/image-need': () => ({ ok: true, verdict: 'needs_image', reason: 'Three steps read best as a graphic.' }) });
    render(<AiAssist {...props} onUseHook={vi.fn()} onDecided={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Check with AI/ })); });
    expect(screen.getByText('Needs an image')).toBeTruthy();
    expect(calls.find((c) => c.url.endsWith('/visual'))!.body).toMatchObject({ decision: 'original_graphic' });
  });

  it('never overwrites an existing decision and waits for a save when the draft has unsaved changes', async () => {
    const calls = route();
    const { rerender } = render(<AiAssist {...props} decided onUseHook={vi.fn()} onDecided={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Check with AI/ })); });
    expect(calls.some((c) => c.url.endsWith('/visual'))).toBe(false);
    expect(screen.getByText('No image needed')).toBeTruthy();
    rerender(<AiAssist {...props} dirty onUseHook={vi.fn()} onDecided={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Check with AI/ })); });
    expect(calls.some((c) => c.url.endsWith('/visual'))).toBe(false);
    expect(screen.getByText(/Save the draft to record it/)).toBeTruthy();
  });

  it('shows the monthly limit once when the cap stops every call', async () => {
    route({ '/image-need': () => ({ ok: false, code: 'AI_LIMIT_REACHED' }), '/hooks': () => ({ ok: false, code: 'AI_LIMIT_REACHED' }), '/qa': () => ({ ok: false, code: 'AI_LIMIT_REACHED' }) });
    render(<AiAssist {...props} onUseHook={vi.fn()} onDecided={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Check with AI/ })); });
    expect(screen.getAllByText('Monthly AI limit reached')).toHaveLength(1);
  });

  it('shows the English check as chips and hands the proposal to the English panel', async () => {
    route();
    const onQaResult = vi.fn();
    render(<AiAssist {...props} onUseHook={vi.fn()} onDecided={vi.fn()} onQaResult={onQaResult} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Check with AI/ })); });
    const chips = document.querySelector('[data-qa-chips]')!;
    expect(chips.textContent).toContain('1 must fix');
    expect(chips.textContent).toContain('1 to consider');
    expect(onQaResult).toHaveBeenCalledWith(expect.objectContaining({ id: 'qa-1' }));
  });

  it('keeps the other parts when one part fails', async () => {
    route({ '/qa': () => ({ ok: false, code: 'PROVIDER_UNAVAILABLE' }) });
    render(<AiAssist {...props} onUseHook={vi.fn()} onDecided={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Check with AI/ })); });
    expect(screen.getByText(/English check did not finish/)).toBeTruthy();
    expect(screen.getByText('No image needed')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Hook options' })).getAllByRole('listitem')).toHaveLength(3);
  });

  it('shows the cap refusal once and still shows parts that finished', async () => {
    route({ '/qa': () => ({ ok: false, code: 'AI_LIMIT_REACHED' }), '/hooks': () => ({ ok: false, code: 'AI_LIMIT_REACHED' }) });
    render(<AiAssist {...props} onUseHook={vi.fn()} onDecided={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Check with AI/ })); });
    expect(screen.getAllByText('Monthly AI limit reached')).toHaveLength(1);
    expect(screen.getByText('No image needed')).toBeTruthy();
  });

  it('shows progress while running and offers no button to a read-only viewer', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<AiAssist {...props} onUseHook={vi.fn()} onDecided={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Check with AI/ })); });
    expect(screen.getByText(/Checking english check, hook suggestions, image check/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    cleanup();
    render(<AiAssist {...props} canEdit={false} onUseHook={vi.fn()} onDecided={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Check with AI/ })).toBeNull();
  });
});

describe('HookChoice use this (#242)', () => {
  const base = { libraryId: 'SYN-L001', alternatives: '1. Hook alternative text', currentHook: 'Current hook', revision: 'rev-1', canEdit: true, onSaved: vi.fn() };

  it('sends the hook to the text editor instead of only filling the field', () => {
    const onUse = vi.fn();
    render(<HookChoice {...base} onUse={onUse} />);
    fireEvent.click(screen.getByRole('button', { name: /Use alternative 1/ }));
    expect(onUse).toHaveBeenCalledWith('Hook alternative text');
  });

  it('shows the pending hook, keeps the field read-only and hides the separate save', () => {
    render(<HookChoice {...base} onUse={vi.fn()} pendingHook="Hook alternative text" />);
    const field = screen.getByLabelText('Chosen hook') as HTMLTextAreaElement;
    expect(field.value).toBe('Hook alternative text');
    expect(field.readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save hook' })).toBeNull();
    expect(screen.getByText('Saves with the draft')).toBeTruthy();
  });
});

describe('DeletePost (#242)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/backlog?post=SYN-L001');
  });

  function setup(fetchImpl: (url: string, body: Record<string, unknown>) => Promise<Response>) {
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => fetchImpl(url, JSON.parse(String(init.body)) as Record<string, unknown>)));
    return render(<ToastProvider><DeletePost libraryId="SYN-L001" revision="rev-1" disabled={false} /></ToastProvider>);
  }

  it('is a labelled danger button with an icon that asks for confirmation with focus on Cancel', () => {
    setup(async () => Response.json({ ok: true }));
    const open = screen.getByRole('button', { name: 'Delete post' });
    expect(open.querySelector('svg')).not.toBeNull();
    expect(open.className).toMatch(/border-block/);
    fireEvent.click(open);
    const group = screen.getByRole('group', { name: 'Confirm delete' });
    expect(within(group).getByText(/Delete this post\?/)).toBeTruthy();
    expect(document.activeElement).toBe(within(group).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(group).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'Confirm delete' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete post' })).toBeTruthy();
  });

  it('shows a busy state, then Post deleted with a large Undo and a countdown, and Undo restores', async () => {
    let finish!: (r: Response) => void;
    const requests: string[] = [];
    setup((url, body) => {
      requests.push(String(body.action));
      if (body.action === 'delete') return new Promise<Response>((resolve) => { finish = resolve; });
      return Promise.resolve(Response.json({ ok: true, value: { revision: 'rev-3' } }));
    });
    const deleted = vi.fn();
    window.addEventListener('cs:post-deleted', deleted);
    fireEvent.click(screen.getByRole('button', { name: 'Delete post' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const busy = screen.getByRole('button', { name: /Deleting/ }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finish(Response.json({ ok: true, value: { revision: 'rev-2' } })); });
    const toasts = screen.getByRole('status', { name: 'Notifications' });
    expect(within(toasts).getByText(/Post deleted/)).toBeTruthy();
    expect(within(toasts).getByText(/\d+ s left/)).toBeTruthy();
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(toasts).getByRole('button', { name: 'Undo' })); });
    expect(requests).toEqual(['delete', 'restore']);
    expect(within(toasts).getByText(/Post restored/)).toBeTruthy();
    window.removeEventListener('cs:post-deleted', deleted);
  });

  it('shows an error toast on failure and lets the user try again', async () => {
    setup(async () => Response.json({ ok: false, code: 'PROVIDER_UNAVAILABLE' }, { status: 503 }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete post' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })); });
    expect(screen.getByRole('alert').textContent).toMatch(/could not be deleted/);
    expect(within(screen.getByRole('status', { name: 'Notifications' })).getByText(/could not be deleted/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
