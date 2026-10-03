'use client';

import { useEffect, useState } from 'react';
import { buttonClass } from '../button-styles';
import { GuardedLink } from '../guarded-link';

/**
 * Reconciliation items (CS-017). "Dismiss as reviewed" is tab-local only
 * (sessionStorage, cleared on sign-out) and keyed by the item's fingerprint, so a
 * dismissed item comes back as soon as its facts change. Dismissing never
 * resolves anything: the item disappears for good only when the authorities agree.
 *
 * CS-048: items are grouped by kind under one collapsible heading each (blocking
 * groups first and open), so ten identical "missing section" rows read as one
 * line with a count instead of ten cards. No coloured rails; a dot plus words
 * carries severity.
 */
export type ReconcileItemView = {
  id: string;
  kind: string;
  severity: 'blocking' | 'attention';
  title: string;
  facts: string[];
  stableIds: string[];
  operationId?: string;
  action: { label: string; href?: string };
};

const KEY = 'cs:reconcile:dismissed';

function readDismissed(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export function ReconcileList({ items }: { items: ReconcileItemView[] }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => {
    queueMicrotask(() => setDismissed(readDismissed()));
  }, []);
  function dismiss(id: string) {
    const next = [...new Set([...dismissed, id])].slice(-200);
    setDismissed(next);
    try {
      sessionStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable: dismissal lasts until reload.
    }
  }
  const visible = items.filter((i) => !dismissed.includes(i.id));
  const hidden = items.length - visible.length;
  const groups = groupByKind(visible);
  return (
    <div className="flex flex-col gap-3">
      {hidden > 0 ? (
        <p className="text-sm text-ink-soft">
          {hidden} reviewed {hidden === 1 ? 'item is' : 'items are'} hidden in this tab.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => {
              setDismissed([]);
              try {
                sessionStorage.removeItem(KEY);
              } catch {
                // ignore
              }
            }}
          >
            Show all
          </button>
        </p>
      ) : null}
      <ul className="flex flex-col gap-3">
        {groups.map((g) => (
          <li key={g.kind}>
            <details open={g.blocking || g.items.length <= 3} data-reconcile-kind={g.kind} className="group rounded-lg border border-line bg-card">
              <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 px-4 py-2 marker:hidden [&::-webkit-details-marker]:hidden">
                <span aria-hidden="true" className="inline-block text-ink-soft transition-transform duration-150 group-open:rotate-90">▸</span>
                <span aria-hidden="true" className={`size-2 rounded-full ${g.blocking ? 'bg-block' : 'bg-attention-line'}`} />
                <span className="font-semibold">{kindLabel(g.kind)}</span>
                <span className="text-sm text-ink-soft tabular-nums">
                  {g.items.length} · {g.blocking ? 'blocking' : 'needs attention'}
                </span>
              </summary>
              <ul className="divide-y divide-line border-t border-line">
                {g.items.map((i) => (
                  <li key={i.id}>
                    <article aria-labelledby={`rc-${i.id}`} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
                      <div className="min-w-0 flex-[1_1_18rem]">
                        <h3 id={`rc-${i.id}`} className="font-medium">
                          {i.title}
                        </h3>
                        <p className="text-sm text-ink-soft">{i.facts.join(' ')}</p>
                        {i.operationId ? <p className="text-xs text-ink-soft">Operation {i.operationId}</p> : null}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {i.action.href ? (
                          <GuardedLink href={i.action.href} className={buttonClass(i.severity === 'blocking' ? 'primary' : 'secondary', 'sm')}>
                            {i.action.label}
                          </GuardedLink>
                        ) : (
                          <span className="text-sm text-ink-soft">Next step: {i.action.label.toLowerCase()}.</span>
                        )}
                        <button type="button" className={buttonClass('secondary', 'sm')} onClick={() => dismiss(i.id)}>
                          Dismiss as reviewed
                        </button>
                      </div>
                    </article>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Plain-words heading for each kind of disagreement (CS-048). Unknown kinds fall back to their name. */
const KIND_LABEL: Record<string, string> = {
  schema_drift: 'Sheet columns changed',
  provider_config: 'Connection not set up',
  markdown_mismatch: 'Sheet draft differs from the Markdown',
  markdown_missing: 'Markdown section missing or duplicated',
  stale_approval: 'Approval out of date',
  stale_visual_approval: 'Image approval out of date',
  zh_stale: 'Chinese version out of date',
  zh_ambiguous: 'Several Threads rows claim one post',
  stale_published_sync: 'Published results not synced',
  typefully_ambiguous: 'Unclear Typefully match',
  typefully_sync_conflict: 'Typefully and the Sheet disagree',
  partial_mutation: 'A change only partly saved',
};

function kindLabel(kind: string): string {
  const fallback = kind.replace(/_/g, ' ');
  return KIND_LABEL[kind] ?? fallback.charAt(0).toUpperCase() + fallback.slice(1);
}

/** Groups keep the report's order; any group containing a blocker is listed first. */
export function groupByKind(items: ReconcileItemView[]): { kind: string; blocking: boolean; items: ReconcileItemView[] }[] {
  const groups = new Map<string, ReconcileItemView[]>();
  for (const item of items) groups.set(item.kind, [...(groups.get(item.kind) ?? []), item]);
  const list = [...groups].map(([kind, members]) => ({ kind, blocking: members.some((m) => m.severity === 'blocking'), items: members }));
  return [...list.filter((g) => g.blocking), ...list.filter((g) => !g.blocking)];
}
