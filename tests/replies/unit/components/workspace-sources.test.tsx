// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReplyIdea } from '@/replies/lib/contracts/api';

/**
 * #245 end to end in the browser layer: the pasted post, the ideas, the sources
 * under each idea, and the rewrite preview that an x or a + asks for.
 *
 * The API is replaced; everything above it is the real workspace, so this checks the
 * wiring a unit test of the reducer logic cannot: which request an x sends, that the
 * editor is only changed by Replace reply, and that a failure leaves the lists alone.
 */

const SESSION = '33333333-3333-4333-8333-000000000001';
const F1 = '11111111-1111-4111-8111-000000000001';
const F2 = '11111111-1111-4111-8111-000000000002';
const IDEA = (n: number, uses: string[] = []): ReplyIdea => ({
  id: `55555555-5555-4555-8555-00000000000${n}`,
  position: n as 0 | 1 | 2,
  angle_label: ['Direct answer', 'Practical next step', 'Recruiter perspective'][n]!,
  reply_text: `Idea ${n} text.`,
  english_meaning: null,
  resource_id: null,
  cta_text: null,
  uses_fact_ids: uses,
  based_on_reply_ids: [],
});

const api = vi.hoisted(() => ({
  analyse: vi.fn(),
  generate: vi.fn(),
  saveDraft: vi.fn(),
  refine: vi.fn(),
  meaning: vi.fn(),
  markPosted: vi.fn(),
  saveContentIdea: vi.fn(),
  progress: vi.fn(),
  librarySearch: vi.fn(),
  libraryPatch: vi.fn(),
  suggestions: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/image-transfer', async () => {
  const { createElement } = await import('react');
  return {
    TransferImage: ({ src, alt }: { src: string; alt?: string }) => createElement('img', { src, alt: alt ?? '' }),
  };
});
vi.mock('@/replies/lib/workspace/client', async () => {
  const actual = await vi.importActual<typeof import('@/replies/lib/workspace/client')>('@/replies/lib/workspace/client');
  return { ...actual, api, newOperationKey: () => crypto.randomUUID() };
});

import { Workspace } from '@/replies/components/replies/Workspace';
import { ApiError } from '@/replies/lib/workspace/client';

const progress = { local_day: '2026-10-28', timezone: 'Asia/Taipei', counts: { linkedin: 0, x: 0, threads: 0 }, targets: { linkedin: 10, x: 10, threads: 10 } };

beforeEach(() => {
  // The action strip measures itself; jsdom has no layout engine to offer.
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', NoopObserver);
  window.localStorage.clear();
  window.sessionStorage.clear();
  Object.values(api).forEach((mock) => mock.mockReset());
  api.progress.mockResolvedValue(progress);
  api.saveDraft.mockImplementation(async (body: { expected_editor_version: number }) => ({
    session_id: SESSION,
    editor_version: body.expected_editor_version + 1,
    draft_hash: 'h',
    meaning_is_stale: false,
  }));
  api.analyse.mockResolvedValue({
    session_id: SESSION,
    source_post_id: null,
    source_version: 1,
    context_version: 1,
    editor_version: 0,
    history: { state: 'empty', items: [], next_cursor: null, reason: 'no_match' },
    resources: { state: 'empty', items: [], reason: 'no_match' },
    generation_expected: true,
  });
  api.generate.mockResolvedValue({
    generation_run_id: '77777777-7777-4777-8777-000000000001',
    ideas: [IDEA(0, [F1]), IDEA(1), IDEA(2)],
    suggested_index: 0,
    allowed_refinements: ['shorter'],
    repetition_warning: null,
  });
  api.suggestions.mockResolvedValue({
    facts: [
      { id: F1, text: 'I reviewed 300 cover letters while hiring.', private: false },
      { id: F2, text: 'A private cover letter story.', private: true },
    ],
    posts: [{ id: 'LIB-1', title: 'Cover letter openings', excerpt: 'e', text: 'The whole earlier post.', platform: 'LinkedIn' }],
    images: [{ id: 'img-1', source: 'bank', title: 'Checklist', alt_text: 'A checklist.', tags: ['cover letter'], url: '/api/replies/images/img-1/file' }],
  });
  api.refine.mockResolvedValue({ proposed_text: 'Rewritten with the new sources.', base_editor_version: 0, english_meaning: null });
});
afterEach(cleanup);

async function start() {
  render(<Workspace />);
  await userEvent.type(screen.getByRole('textbox', { name: /Paste the post or comment/ }), 'Does a cover letter still matter?');
  await userEvent.click(screen.getByRole('button', { name: 'Get reply ideas' }));
  await screen.findByText('Idea 0 text.');
}

const panelFor = (label: string) => screen.getByRole('group', { name: `Used in this reply: ${label}` });

describe('suggestions are found by the same click that asks for ideas', () => {
  it('searches once for the post, then once more for the facts the ideas cite', async () => {
    await start();
    await waitFor(() => expect(api.suggestions).toHaveBeenCalledTimes(2));
    expect(api.suggestions.mock.calls[0]![0]).toEqual({ session_id: SESSION });
    expect(api.suggestions.mock.calls[1]![0]).toEqual({ session_id: SESSION, fact_ids: [F1] });
  });

  it('shows what an idea drew on with its text, and the other matches below', async () => {
    await start();
    const panel = within(panelFor('Direct answer'));
    expect(await panel.findByText('I reviewed 300 cover letters while hiring.')).toBeTruthy();
    expect(panel.getByRole('button', { name: 'Remove: I reviewed 300 cover letters while hiring.' })).toBeTruthy();
    const more = panel.getByText('A private cover letter story.').closest('li')!;
    expect(within(more).getByText('private')).toBeTruthy();
    expect(panel.getByRole('button', { name: 'Add: Cover letter openings' })).toBeTruthy();
  });

  it('shows the images section with the match and a way to create a new one', async () => {
    await start();
    expect(await screen.findByRole('heading', { name: 'Images you have used' })).toBeTruthy();
    expect(await screen.findByRole('img', { name: 'A checklist.' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create new' })).toBeTruthy();
  });

  it('leaves the rest of the screen alone when the search fails', async () => {
    api.suggestions.mockRejectedValue(new Error('down'));
    await start();
    expect(screen.getAllByRole('button', { name: 'Use this' })).toHaveLength(3);
    await waitFor(() => expect(screen.queryByText(/Finding facts/)).toBeNull());
  });
});

describe('a + under an idea', () => {
  it('asks for a rewrite of that idea with the added fact, and shows a preview without touching the editor', async () => {
    await start();
    const panel = within(panelFor('Direct answer'));
    await userEvent.click(await panel.findByRole('button', { name: 'Add: A private cover letter story.' }));

    await waitFor(() => expect(api.refine).toHaveBeenCalledTimes(1));
    expect(api.refine.mock.calls[0]![0]).toMatchObject({
      session_id: SESSION,
      action: 'use_sources',
      extra_fact_ids: [F2],
      idea_id: IDEA(0).id,
    });
    expect(api.refine.mock.calls[0]![0]).not.toHaveProperty('excluded_fact_ids');

    expect(await screen.findByText('Rewritten with the new sources.')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Your reply' }) as HTMLTextAreaElement).value).toBe('');
    // The added fact now sits in the idea's Used line.
    expect(within(panelFor('Direct answer')).getByRole('button', { name: 'Remove: A private cover letter story.' })).toBeTruthy();
  });

  it('applies the rewrite only on Replace reply, and the editor then draws on the new set', async () => {
    await start();
    await userEvent.click(await within(panelFor('Direct answer')).findByRole('button', { name: 'Add: A private cover letter story.' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Replace reply' }));

    const editor = screen.getByRole('textbox', { name: 'Your reply' }) as HTMLTextAreaElement;
    expect(editor.value).toBe('Rewritten with the new sources.');
    const editorPanel = within(screen.getByRole('group', { name: 'Used in this reply: Your reply' }));
    expect(editorPanel.getByText('I reviewed 300 cover letters while hiring.')).toBeTruthy();
    expect(editorPanel.getByText('A private cover letter story.')).toBeTruthy();
  });

  it('puts the selection back when the preview is rejected', async () => {
    await start();
    await userEvent.click(await within(panelFor('Direct answer')).findByRole('button', { name: 'Add: A private cover letter story.' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Keep my reply' }));
    const panel = within(panelFor('Direct answer'));
    expect(panel.getByRole('button', { name: 'Add: A private cover letter story.' })).toBeTruthy();
    expect(panel.queryByRole('button', { name: 'Remove: A private cover letter story.' })).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Your reply' }) as HTMLTextAreaElement).value).toBe('');
  });

  it('sends an earlier post as an id to draw on, never its text', async () => {
    await start();
    await userEvent.click(await within(panelFor('Direct answer')).findByRole('button', { name: 'Add: Cover letter openings' }));
    await waitFor(() => expect(api.refine).toHaveBeenCalled());
    const request = api.refine.mock.calls[0]![0];
    expect(request.extra_post_ids).toEqual(['LIB-1']);
    expect(JSON.stringify(request)).not.toContain('The whole earlier post.');
  });
});

describe('an x under an idea', () => {
  it('asks for the fact to be left out, and lists it as a suggestion again', async () => {
    await start();
    await userEvent.click(await within(panelFor('Direct answer')).findByRole('button', { name: 'Remove: I reviewed 300 cover letters while hiring.' }));
    await waitFor(() => expect(api.refine).toHaveBeenCalledTimes(1));
    expect(api.refine.mock.calls[0]![0]).toMatchObject({ excluded_fact_ids: [F1], idea_id: IDEA(0).id });
    expect(api.refine.mock.calls[0]![0]).not.toHaveProperty('extra_fact_ids');
    const panel = within(panelFor('Direct answer'));
    await waitFor(() => expect(panel.getByRole('button', { name: 'Add: I reviewed 300 cover letters while hiring.' })).toBeTruthy());
  });
});

describe('failures', () => {
  it('reverts the lists and says so when the rewrite fails', async () => {
    api.refine.mockRejectedValue(new ApiError(502, { code: 'provider_unavailable', message: 'x', retryable: true, request_id: 'r' }));
    await start();
    await userEvent.click(await within(panelFor('Direct answer')).findByRole('button', { name: 'Add: A private cover letter story.' }));
    expect(await screen.findByText("Couldn't rewrite with that change. Your reply is unchanged.")).toBeTruthy();
    const panel = within(panelFor('Direct answer'));
    expect(panel.getByRole('button', { name: 'Add: A private cover letter story.' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Replace reply' })).toBeNull();
  });

  it('says Monthly AI limit reached at the cap', async () => {
    api.refine.mockRejectedValue(new ApiError(429, { code: 'monthly_ai_limit_reached', message: 'Monthly AI limit reached', retryable: false, request_id: 'r' }));
    await start();
    await userEvent.click(await within(panelFor('Direct answer')).findByRole('button', { name: 'Add: A private cover letter story.' }));
    expect(await screen.findByText('Monthly AI limit reached')).toBeTruthy();
  });

  it('says a rewrite that failed the grounding checks is not offered', async () => {
    api.refine.mockRejectedValue(new ApiError(422, { code: 'withheld_unsafe', message: 'x', retryable: false, request_id: 'r' }));
    await start();
    await userEvent.click(await within(panelFor('Direct answer')).findByRole('button', { name: 'Add: A private cover letter story.' }));
    expect(await screen.findByText(/didn't pass the grounding checks/)).toBeTruthy();
  });

  it('refuses a second rewrite while one is running', async () => {
    let finish: (value: unknown) => void = () => undefined;
    api.refine.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await start();
    await userEvent.click(await within(panelFor('Direct answer')).findByRole('button', { name: 'Add: A private cover letter story.' }));
    const other = within(panelFor('Practical next step')).getAllByRole('button', { name: /^Add:/ })[0]!;
    expect((other as HTMLButtonElement).disabled).toBe(true);
    finish({ proposed_text: 'Done.', base_editor_version: 0, english_meaning: null });
    await screen.findByText('Done.');
  });
});

describe('guides keep the existing link convention', () => {
  it('inserts a guide as the CTA text and link on blank lines, from the editor panel', async () => {
    api.analyse.mockResolvedValue({
      session_id: SESSION, source_post_id: null, source_version: 1, context_version: 1, editor_version: 0,
      history: { state: 'empty', items: [], next_cursor: null, reason: 'no_match' },
      resources: {
        state: 'ready',
        items: [{ id: '22222222-2222-4222-8222-000000000002', version: 1, type: 'guide', ownership: 'own', title: 'Cover letter guide', url: 'https://resources.example.com/guides/cover-letters', locale: 'en', english_fallback: false, why_it_fits: 'It fits.', access_notes: null, cta_text: 'I wrote something on this.' }],
        reason: null,
      },
      generation_expected: true,
    });
    await start();
    await userEvent.type(screen.getByRole('textbox', { name: 'Your reply' }), 'My reply.');
    const editorPanel = within(await screen.findByRole('group', { name: 'Used in this reply: Your reply' }));
    await userEvent.click(editorPanel.getByRole('button', { name: 'Add: Cover letter guide' }));
    expect((screen.getByRole('textbox', { name: 'Your reply' }) as HTMLTextAreaElement).value).toBe(
      'My reply.\n\nI wrote something on this. https://resources.example.com/guides/cover-letters',
    );
    // It is now in the Used line, and its x removes exactly what was inserted.
    await userEvent.click(within(screen.getByRole('group', { name: 'Used in this reply: Your reply' })).getByRole('button', { name: 'Remove: Cover letter guide' }));
    expect((screen.getByRole('textbox', { name: 'Your reply' }) as HTMLTextAreaElement).value).toBe('My reply.');
    expect(api.refine).not.toHaveBeenCalled();
  });
});
