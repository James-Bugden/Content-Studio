'use client';

import { useState } from 'react';
import { Button, cx, Meta, Pill, StatusLine } from './primitives';
import { SOURCES } from '@/replies/lib/workspace/copy';

/**
 * "Used in this reply" and "More suggestions" (#245).
 *
 * One small panel, used under every idea and under the editor. The first row lists
 * what the reply draws on, each with an x. The second lists other matches, each
 * with a +. Either click asks for a rewrite with the changed set; nothing here edits
 * text, because the rewrite arrives as a preview the owner applies or discards.
 *
 * Earlier posts are reference material only: they can be opened or copied, and
 * adding one lets the rewrite draw on its ideas. Nothing inserts a whole post.
 */

export type SourceKindLabel = 'fact' | 'post' | 'guide';

export interface SourceItem {
  kind: SourceKindLabel;
  id: string;
  text: string;
  /** A fact marked private_context_only. Usable, with a small tag. */
  isPrivate?: boolean;
  /** Earlier posts only. */
  openHref?: string;
  copyText?: string;
}

export interface SourcesPanelProps {
  /** Distinguishes the instances on one page, for accessible names. */
  scopeLabel: string;
  used: SourceItem[];
  more: SourceItem[];
  /** A rewrite for this panel is running; further clicks wait. */
  busy: boolean;
  /** Matches are still being looked up. */
  loadingMore?: boolean;
  notice?: string | null;
  /** Guides can only be inserted into the editor, so an idea card omits the control. */
  onRemove(item: SourceItem): void;
  onAdd(item: SourceItem): void;
}

const KIND_LABEL: Record<SourceKindLabel, string> = {
  fact: '',
  post: SOURCES.post,
  guide: SOURCES.guide,
};

function Chip({
  item,
  action,
  busy,
  onAction,
}: {
  item: SourceItem;
  action: 'remove' | 'add';
  busy: boolean;
  onAction(): void;
}) {
  const [copied, setCopied] = useState(false);
  const label = action === 'remove' ? SOURCES.remove(item.text) : SOURCES.add(item.text);
  const verb = action === 'add' && item.kind === 'guide' ? SOURCES.insert : null;

  return (
    <li className="flex items-start gap-2 rounded-md border border-hairline bg-paper px-2 py-1">
      <div className="min-w-0 flex-1">
        {item.kind !== 'fact' || item.isPrivate ? (
          <div className="mb-0.5 flex flex-wrap gap-1">
            {item.kind !== 'fact' ? <Pill>{KIND_LABEL[item.kind]}</Pill> : null}
            {item.isPrivate ? <Pill>{SOURCES.private}</Pill> : null}
          </div>
        ) : null}
        <p className="line-clamp-2 text-meta text-ink [overflow-wrap:anywhere]">{item.text}</p>
        {item.kind === 'post' ? (
          <div className="mt-1 flex flex-wrap gap-2">
            {item.openHref ? (
              <a
                href={item.openHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-meta text-ink-soft underline"
              >
                {SOURCES.open}
              </a>
            ) : null}
            {item.copyText ? (
              <button
                type="button"
                className="text-meta text-ink-soft underline"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(item.copyText ?? '')
                    .then(() => setCopied(true))
                    .catch(() => undefined);
                }}
              >
                {copied ? SOURCES.copied : SOURCES.copy}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <Button
        variant={verb ? 'secondary' : 'quiet'}
        className={cx('shrink-0', verb ? '' : 'min-w-8 text-base')}
        aria-label={label}
        title={label}
        disabled={busy}
        onClick={onAction}
      >
        {verb ?? (action === 'remove' ? '×' : '+')}
      </Button>
    </li>
  );
}

export function SourcesPanel(props: SourcesPanelProps) {
  const { scopeLabel, used, more, busy, notice } = props;

  return (
    <div className="mt-2 border-t border-hairline pt-2" role="group" aria-label={`${SOURCES.used}: ${scopeLabel}`}>
      <p className="mb-1 text-meta font-medium text-ink">{SOURCES.used}</p>
      {used.length === 0 ? (
        <Meta>{SOURCES.usedNone}</Meta>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {used.map((item) => (
            <Chip key={`${item.kind}:${item.id}`} item={item} action="remove" busy={busy} onAction={() => props.onRemove(item)} />
          ))}
        </ul>
      )}

      <p className="mb-1 mt-2 text-meta font-medium text-ink">{SOURCES.more}</p>
      {more.length === 0 ? (
        <Meta>{props.loadingMore ? SOURCES.loading : SOURCES.moreNone}</Meta>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {more.map((item) => (
            <Chip key={`${item.kind}:${item.id}`} item={item} action="add" busy={busy} onAction={() => props.onAdd(item)} />
          ))}
        </ul>
      )}
      {more.some((item) => item.kind === 'post') ? <Meta className="mt-1">{SOURCES.referenceOnly}</Meta> : null}

      {busy ? <StatusLine>{SOURCES.rewriting}</StatusLine> : null}
      {notice ? <StatusLine tone="error">{notice}</StatusLine> : null}
    </div>
  );
}
