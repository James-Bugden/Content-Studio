'use client';

import { useState } from 'react';
import { Button, Card, Meta, Pill, ReplyText, SectionHeading, StatusLine } from './primitives';
import { HISTORY } from '@/replies/lib/workspace/copy';
import { localDayOf } from '@/replies/lib/workspace/dates';
import { PLATFORM_LABELS, type Provenance } from '@/replies/lib/contracts/vocabulary';
import type { PastReply } from '@/replies/lib/contracts/api';
import type { HistorySection } from '@/replies/lib/workspace/reducer';

/**
 * Prior writing (D04, D05, RET-04).
 *
 * The heading is the honest bit. "You've replied to similar posts before" is a
 * claim about what the owner actually posted, so it is used only when every row is
 * a confirmed reply. Drafts and main posts sit under "Saved writing" with their
 * provenance on the row, because presenting an AI draft as something the owner said
 * would quietly corrupt the one archive this product exists to build.
 *
 * There are no similarity percentages. A number would imply a precision the ranking
 * does not have.
 */

const PROVENANCE_LABEL: Readonly<Record<Provenance, string>> = Object.freeze({
  posted_confirmed: 'Posted',
  user_edited_unconfirmed: 'Draft, not confirmed',
  published_main_post: 'Your own post',
  ai_draft: 'AI draft',
});

function dateLabel(reply: PastReply): string {
  if (reply.date_precision === 'unknown') return HISTORY.dateUnknown;
  return localDayOf(reply.posted_at, reply.posted_date) ?? HISTORY.dateUnknown;
}

function excerptOf(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > 160 ? `${collapsed.slice(0, 160)}...` : collapsed;
}

function PastReplyRow({
  reply,
  onUse,
  onCopy,
}: {
  reply: PastReply;
  onUse(reply: PastReply): void;
  onCopy(reply: PastReply): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isChinese = /\p{Script=Han}/u.test(reply.full_text);

  return (
    <Card as="li" className="mb-2">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Meta>{PLATFORM_LABELS[reply.platform]}</Meta>
        <Meta aria-label={`Posted ${dateLabel(reply)}`}>{dateLabel(reply)}</Meta>
        <Pill tone={reply.provenance === 'posted_confirmed' ? 'green' : 'neutral'}>
          {PROVENANCE_LABEL[reply.provenance]}
        </Pill>
      </div>

      <ReplyText text={expanded ? reply.full_text : excerptOf(reply.full_text)} chinese={isChinese} />

      <div className="mt-2 flex flex-wrap gap-2">
        {reply.full_text.length > 160 ? (
          <Button variant="quiet" onClick={() => setExpanded((value) => !value)}>
            {expanded ? HISTORY.collapse : HISTORY.expand}
          </Button>
        ) : null}
        <Button variant="quiet" onClick={() => onCopy(reply)}>
          {HISTORY.copy}
        </Button>
        <Button variant="quiet" onClick={() => onUse(reply)}>
          {HISTORY.use}
        </Button>
      </div>
    </Card>
  );
}

export interface PastRepliesSectionProps {
  section: HistorySection;
  onRetry(): void;
  onMore(): void;
  onUse(reply: PastReply): void;
  onCopy(reply: PastReply): void;
}

export function PastRepliesSection({ section, onRetry, onMore, onUse, onCopy }: PastRepliesSectionProps) {
  const allConfirmed =
    section.items.length > 0 && section.items.every((r) => r.provenance === 'posted_confirmed');

  return (
    <section aria-labelledby="history-heading" className="mb-4">
      <SectionHeading id="history-heading">
        {allConfirmed ? HISTORY.headingConfirmed : HISTORY.headingSaved}
      </SectionHeading>

      {section.state === 'loading' ? <StatusLine>{HISTORY.loading}</StatusLine> : null}

      {section.state === 'error' ? (
        <div>
          <StatusLine tone="error">{HISTORY.error}</StatusLine>
          <Button className="mt-2" onClick={onRetry}>
            {HISTORY.retry}
          </Button>
        </div>
      ) : null}

      {section.state === 'empty' ? <StatusLine>{HISTORY.empty}</StatusLine> : null}

      {section.state === 'ready' ? (
        <>
          <ul className="list-none p-0">
            {section.items.map((reply) => (
              <PastReplyRow key={reply.id} reply={reply} onUse={onUse} onCopy={onCopy} />
            ))}
          </ul>
          {section.nextCursor ? <Button onClick={onMore}>{HISTORY.more}</Button> : null}
        </>
      ) : null}
    </section>
  );
}

