// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IdeasSection } from '@/replies/components/replies/IdeasSection';
import { SourcesPanel, type SourceItem } from '@/replies/components/replies/SourcesPanel';
import type { ReplyIdea } from '@/replies/lib/contracts/api';

/**
 * #245: "Used in this reply" and "More suggestions".
 *
 * What a screenshot cannot say: that each x and + is a real, named control; that a
 * private fact is tagged rather than hidden; that an earlier post offers Open and
 * Copy but nothing that would insert it; and that a pending rewrite blocks a second.
 */

afterEach(cleanup);

const fact = (overrides: Partial<SourceItem> = {}): SourceItem => ({
  kind: 'fact',
  id: 'f1',
  text: 'I reviewed 300 cover letters while hiring.',
  ...overrides,
});
const post = (overrides: Partial<SourceItem> = {}): SourceItem => ({
  kind: 'post',
  id: 'LIB-1',
  text: 'Open a cover letter with the problem you solved',
  openHref: '/review/LIB-1',
  copyText: 'Full text of the earlier post.',
  ...overrides,
});
const guide = (overrides: Partial<SourceItem> = {}): SourceItem => ({ kind: 'guide', id: 'g1', text: 'Cover letter guide', ...overrides });

function panel(props: Partial<React.ComponentProps<typeof SourcesPanel>> = {}) {
  return render(
    <SourcesPanel
      scopeLabel="Direct answer"
      used={[fact()]}
      more={[fact({ id: 'f2', text: 'I coached a friend through interviews.', isPrivate: true }), post()]}
      busy={false}
      onRemove={vi.fn()}
      onAdd={vi.fn()}
      {...props}
    />,
  );
}

describe('Used in this reply / More suggestions', () => {
  it('shows both rows with their headings', () => {
    panel();
    expect(screen.getByText('Used in this reply')).toBeTruthy();
    expect(screen.getByText('More suggestions')).toBeTruthy();
    expect(screen.getByText('I reviewed 300 cover letters while hiring.')).toBeTruthy();
  });

  it('gives every used source an x named for what it removes', async () => {
    const onRemove = vi.fn();
    panel({ onRemove });
    const remove = screen.getByRole('button', { name: 'Remove: I reviewed 300 cover letters while hiring.' });
    await userEvent.click(remove);
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ kind: 'fact', id: 'f1' }));
  });

  it('gives every other match a + named for what it adds', async () => {
    const onAdd = vi.fn();
    panel({ onAdd });
    await userEvent.click(screen.getByRole('button', { name: 'Add: I coached a friend through interviews.' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 'f2' }));
    await userEvent.click(screen.getByRole('button', { name: `Add: ${post().text}` }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ kind: 'post', id: 'LIB-1' }));
  });

  it('tags a private fact instead of hiding it', () => {
    panel();
    const row = screen.getByText('I coached a friend through interviews.').closest('li')!;
    expect(within(row).getByText('private')).toBeTruthy();
    // A public fact carries no tag.
    const publicRow = screen.getByText('I reviewed 300 cover letters while hiring.').closest('li')!;
    expect(within(publicRow).queryByText('private')).toBeNull();
  });

  it('offers an earlier post to Open and Copy, as reference only', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    panel();
    const row = screen.getByText(post().text).closest('li')!;
    expect(within(row).getByText('Earlier post')).toBeTruthy();
    const open = within(row).getByRole('link', { name: 'Open' });
    expect(open.getAttribute('href')).toBe('/review/LIB-1');
    expect(open.getAttribute('target')).toBe('_blank');
    expect(open.getAttribute('rel')).toContain('noopener');
    await userEvent.click(within(row).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('Full text of the earlier post.');
    expect(screen.getByText('Reference only. Nothing is inserted.')).toBeTruthy();
    // Nothing on a post says Insert.
    expect(within(row).queryByRole('button', { name: /insert/i })).toBeNull();
  });

  it('shows a guide with an Insert control, which is the one place a link goes in', async () => {
    const onAdd = vi.fn();
    panel({ used: [], more: [guide()], onAdd });
    const insert = screen.getByRole('button', { name: 'Add: Cover letter guide' });
    expect(insert.textContent).toBe('Insert');
    await userEvent.click(insert);
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ kind: 'guide', id: 'g1' }));
  });

  it('says plainly when a row is empty, and when matches are still loading', () => {
    const { rerender } = panel({ used: [], more: [] });
    expect(screen.getByText('Nothing yet.')).toBeTruthy();
    expect(screen.getByText('No other matches.')).toBeTruthy();
    rerender(
      <SourcesPanel scopeLabel="x" used={[]} more={[]} busy={false} loadingMore onRemove={vi.fn()} onAdd={vi.fn()} />,
    );
    expect(screen.getByText('Finding facts, posts and images...')).toBeTruthy();
  });

  it('disables every control while a rewrite is running, and says so', () => {
    panel({ busy: true });
    for (const button of screen.getAllByRole('button', { name: /^(Remove|Add):/ })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByText('Rewriting with your change...')).toBeTruthy();
  });

  it('shows a failure message without changing the lists', () => {
    panel({ notice: "Couldn't rewrite with that change. Your reply is unchanged." });
    expect(screen.getByText("Couldn't rewrite with that change. Your reply is unchanged.")).toBeTruthy();
    expect(screen.getByText('I reviewed 300 cover letters while hiring.')).toBeTruthy();
  });

  it('keeps accessible names distinct between two ideas on one page', () => {
    render(
      <>
        <SourcesPanel scopeLabel="Direct answer" used={[]} more={[]} busy={false} onRemove={vi.fn()} onAdd={vi.fn()} />
        <SourcesPanel scopeLabel="Practical next step" used={[]} more={[]} busy={false} onRemove={vi.fn()} onAdd={vi.fn()} />
      </>,
    );
    expect(screen.getByRole('group', { name: 'Used in this reply: Direct answer' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Used in this reply: Practical next step' })).toBeTruthy();
  });
});

describe('under each idea', () => {
  const idea = (id: string, label: string): ReplyIdea => ({
    id,
    position: 0,
    angle_label: label,
    reply_text: `Example reply for ${label}.`,
    english_meaning: null,
    resource_id: null,
    cta_text: null,
    uses_fact_ids: [],
    based_on_reply_ids: [],
  });

  it('renders the panel inside each idea card, and nothing when suggestions are off', () => {
    const ideas = [idea('a', 'Direct answer'), idea('b', 'Practical next step'), idea('c', 'Recruiter perspective')];
    const state = { status: 'ready' as const, ideas, suggestedIndex: 0, warnings: [] };
    const { rerender } = render(
      <IdeasSection
        state={state}
        platform="linkedin"
        resources={[]}
        renderSources={(candidate) => <p>panel for {candidate.angle_label}</p>}
        onUse={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText('panel for Direct answer')).toBeTruthy();
    expect(screen.getByText('panel for Recruiter perspective')).toBeTruthy();

    rerender(<IdeasSection state={state} platform="linkedin" resources={[]} onUse={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.queryByText(/panel for/)).toBeNull();
    // The existing control is untouched.
    expect(screen.getAllByRole('button', { name: 'Use this' })).toHaveLength(3);
  });
});

describe('a failed search is not "no matches" (#251)', () => {
  it('says the post search failed instead of "No other matches."', () => {
    panel({ more: [], searchFailed: ['posts'] });
    expect(screen.getByText("Couldn't search your posts.")).toBeTruthy();
    expect(screen.queryByText('No other matches.')).toBeNull();
  });

  it('names the facts search separately and keeps working matches visible', () => {
    panel({ searchFailed: ['facts'] });
    expect(screen.getByText("Couldn't search your facts.")).toBeTruthy();
    expect(screen.queryByText("Couldn't search your posts.")).toBeNull();
  });
});
