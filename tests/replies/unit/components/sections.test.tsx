// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PastRepliesSection } from '@/replies/components/replies/PastRepliesSection';
import { ResourcesSection } from '@/replies/components/replies/ResourcesSection';
import { IdeasSection } from '@/replies/components/replies/IdeasSection';
import type { PastReply, QualifiedResource, ReplyIdea } from '@/replies/lib/contracts/api';
import type { HistorySection, ResourceSection } from '@/replies/lib/workspace/reducer';

/**
 * RET-04, RES-03, RES-04 and D07 at the component level.
 *
 * These are the claims a screenshot cannot check: that a heading only appears
 * when it is true, that three different failures do not look like one, and that
 * a card never says something the registry did not.
 */

afterEach(cleanup);

const reply = (overrides: Partial<PastReply> = {}): PastReply => ({
  id: '11111111-1111-4111-8111-000000000001',
  platform: 'linkedin',
  excerpt: 'An excerpt.',
  full_text: 'An excerpt.',
  provenance: 'posted_confirmed',
  publication_evidence: 'user_confirmed',
  posted_at: '2026-02-01T00:00:00.000Z',
  posted_date: null,
  date_precision: 'timestamp',
  ...overrides,
});

const history = (overrides: Partial<HistorySection> = {}): HistorySection => ({
  state: 'ready',
  items: [reply()],
  nextCursor: null,
  reason: null,
  ...overrides,
});

const resources = (overrides: Partial<ResourceSection> = {}): ResourceSection => ({
  state: 'ready',
  items: [],
  reason: null,
  ...overrides,
});

const resource = (overrides: Partial<QualifiedResource> = {}): QualifiedResource => ({
  id: '22222222-2222-4222-8222-000000000002',
  version: 1,
  type: 'guide',
  ownership: 'own',
  title: 'Example guide',
  url: 'https://resources.example.com/guides/example',
  locale: 'en',
  english_fallback: false,
  why_it_fits: 'It covers the thing the post asks about.',
  access_notes: null,
  cta_text: 'I wrote something on this.',
  ...overrides,
});

const noop = () => undefined;

describe('past replies: the heading has to be true (RET-04)', () => {
  it('claims a posted reply only when every row is one', () => {
    render(
      <PastRepliesSection
        section={history()}
        onRetry={noop}
        onMore={noop}
        onUse={noop}
        onCopy={noop}
      />,
    );
    expect(screen.getByRole('heading', { name: "You've replied to similar posts before" })).toBeTruthy();
  });

  it('falls back to Saved writing when a draft is in the list', () => {
    render(
      <PastRepliesSection
        section={history({ items: [reply(), reply({ id: 'b', provenance: 'ai_draft' })] })}
        onRetry={noop}
        onMore={noop}
        onUse={noop}
        onCopy={noop}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Saved writing' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: "You've replied to similar posts before" })).toBeNull();
  });

  it('labels an AI draft as one rather than as something the owner posted', () => {
    render(
      <PastRepliesSection
        section={history({ items: [reply({ provenance: 'ai_draft' })] })}
        onRetry={noop}
        onMore={noop}
        onUse={noop}
        onCopy={noop}
      />,
    );
    expect(screen.getByText('AI draft')).toBeTruthy();
  });

  it('says a date is unknown rather than inventing one', () => {
    render(
      <PastRepliesSection
        section={history({
          items: [reply({ posted_at: null, posted_date: null, date_precision: 'unknown' })],
        })}
        onRetry={noop}
        onMore={noop}
        onUse={noop}
        onCopy={noop}
      />,
    );
    expect(screen.getByText('Date unknown')).toBeTruthy();
  });

  it('separates a failed search from an empty one', () => {
    const { unmount } = render(
      <PastRepliesSection
        section={history({ state: 'empty', items: [] })}
        onRetry={noop}
        onMore={noop}
        onUse={noop}
        onCopy={noop}
      />,
    );
    expect(screen.getByText('No matching past replies yet.')).toBeTruthy();
    unmount();

    render(
      <PastRepliesSection
        section={history({ state: 'error', items: [], reason: 'lookup_failed' })}
        onRetry={noop}
        onMore={noop}
        onUse={noop}
        onCopy={noop}
      />,
    );
    expect(screen.getByText("Couldn't search past replies.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry search' })).toBeTruthy();
  });
});

describe('resources: three failures that must not look like one (RES-03)', () => {
  it('says nothing qualified when the search succeeded', () => {
    render(
      <ResourcesSection
        section={resources({ state: 'empty', reason: 'no_match' })}
        addedResourceId={null}
        onAdd={noop}
        onCopyLink={noop}
        onRetry={noop}
        onOpenResources={noop}
      />,
    );
    expect(screen.getByText('Nothing worth linking for this one.')).toBeTruthy();
  });

  it('says the catalogue is empty and offers the way to fill it', () => {
    render(
      <ResourcesSection
        section={resources({ state: 'empty', reason: 'empty_catalog' })}
        addedResourceId={null}
        onAdd={noop}
        onCopyLink={noop}
        onRetry={noop}
        onOpenResources={noop}
      />,
    );
    expect(screen.getByText('Add your first resource to find it here.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Resources' })).toBeTruthy();
  });

  it('never turns a failed lookup into confident silence', () => {
    render(
      <ResourcesSection
        section={resources({ state: 'error', reason: 'lookup_failed' })}
        addedResourceId={null}
        onAdd={noop}
        onCopyLink={noop}
        onRetry={noop}
        onOpenResources={noop}
      />,
    );
    expect(screen.getByText("Couldn't check your resources.")).toBeTruthy();
    expect(screen.queryByText('Nothing worth linking for this one.')).toBeNull();
  });
});

describe('resource cards say only what is verified (D06)', () => {
  it('offers a recommendation, not a broken link, for a book with no URL', () => {
    render(
      <ResourcesSection
        section={resources({ items: [resource({ ownership: 'book', type: 'book', url: null })] })}
        addedResourceId={null}
        onAdd={noop}
        onCopyLink={noop}
        onRetry={noop}
        onOpenResources={noop}
      />,
    );
    expect(screen.getByRole('button', { name: 'Add recommendation' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
  });

  it('labels an English fallback instead of implying a Chinese page exists', () => {
    render(
      <ResourcesSection
        section={resources({ items: [resource({ locale: 'zh-TW', english_fallback: true })] })}
        addedResourceId={null}
        onAdd={noop}
        onCopyLink={noop}
        onRetry={noop}
        onOpenResources={noop}
      />,
    );
    expect(screen.getByText('English resource')).toBeTruthy();
  });

  it('shows no access wording at all when the registry verified none', () => {
    render(
      <ResourcesSection
        section={resources({ items: [resource()] })}
        addedResourceId={null}
        onAdd={noop}
        onCopyLink={noop}
        onRetry={noop}
        onOpenResources={noop}
      />,
    );
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/free/i);
    expect(text).not.toMatch(/no signup/i);
  });

  it('shows Already added instead of letting the same resource in twice', async () => {
    const onAdd = vi.fn();
    render(
      <ResourcesSection
        section={resources({ items: [resource()] })}
        addedResourceId={resource().id}
        onAdd={onAdd}
        onCopyLink={noop}
        onRetry={noop}
        onOpenResources={noop}
      />,
    );
    const button = screen.getByRole('button', { name: 'Already added' });
    expect(button.hasAttribute('disabled')).toBe(true);
    await userEvent.click(button);
    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe('ideas: no empty placeholders on failure (D07)', () => {
  const idea = (position: number): ReplyIdea => ({
    id: `idea-${position}`,
    position,
    angle_label: `Angle ${position}`,
    reply_text: `Reply ${position}`,
    english_meaning: null,
    resource_id: null,
    cta_text: null,
    uses_fact_ids: [],
    based_on_reply_ids: [],
  });

  it('says it is empty rather than rendering a bare heading', () => {
    // Found by the T2 visual review, not by any test: `idle` is a real state in
    // IdeasState and IdeasSection had no branch for it, so before the owner
    // presses the button the section is a heading with nothing under it. Both
    // sections above it explain their own emptiness, and this component's own
    // docstring argues that a card-shaped hole wrongly implies text is coming.
    // A heading with nothing under it makes the same promise.
    render(
      <IdeasSection
        state={{ status: 'idle' }}
        platform="linkedin"
        resources={[]}
        onUse={noop}
        onRetry={noop}
      />,
    );

    expect(screen.getByText('No reply ideas yet.')).toBeTruthy();
    // Still no placeholder cards, and no retry for something never attempted.
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('shows an actionable retry rather than three empty cards', () => {
    render(
      <IdeasSection
        state={{ status: 'failed', code: 'failed', retryAfterSeconds: null }}
        platform="linkedin"
        resources={[]}
        onUse={noop}
        onRetry={noop}
      />,
    );
    expect(screen.getByText("Couldn't create reply ideas. Your draft is unchanged.")).toBeTruthy();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('does not offer a retry when the provider is simply not set up', () => {
    render(
      <IdeasSection
        state={{ status: 'failed', code: 'not_configured', retryAfterSeconds: null }}
        platform="linkedin"
        resources={[]}
        onUse={noop}
        onRetry={noop}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('claims a resource is included only when the idea carries one', () => {
    render(
      <IdeasSection
        state={{
          status: 'ready',
          ideas: [{ ...idea(0), resource_id: resource().id }, idea(1), idea(2)],
          suggestedIndex: 0,
          warnings: [],
        }}
        platform="linkedin"
        resources={[resource()]}
        onUse={noop}
        onRetry={noop}
      />,
    );
    expect(screen.getAllByText(/Includes: Example guide/)).toHaveLength(1);
  });

  it('shows a repetition warning as a sentence, never as a percentage', () => {
    render(
      <IdeasSection
        state={{
          status: 'ready',
          ideas: [idea(0), idea(1), idea(2)],
          suggestedIndex: 0,
          warnings: ['Very similar wording to a reply posted on 2026-02-01.'],
        }}
        platform="linkedin"
        resources={[]}
        onUse={noop}
        onRetry={noop}
      />,
    );
    expect(screen.getByText('Very similar wording to a reply posted on 2026-02-01.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\d+%/);
  });
});

