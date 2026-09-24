'use client';

import { useEffect, useState } from 'react';
import { buttonClass } from '../button-styles';
import { GuardedLink } from '../guarded-link';

/**
 * Reconciliation items (CS-017). "Dismiss as reviewed" is tab-local only
 * (sessionStorage, cleared on sign-out) and keyed by the item's fingerprint, so a
 * dismissed item comes back as soon as its facts change. Dismissing never
 * resolves anything: the item disappears for good only when the authorities agree.
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
        {visible.map((i) => (
          <li key={i.id}>
            <article aria-labelledby={`rc-${i.id}`} className={`rounded-lg border bg-card p-4 ${i.severity === 'blocking' ? 'border-l-4 border-block' : 'border-line'}`}>
              <p className="text-xs font-semibold tracking-wide text-ink-soft">
                {i.severity === 'blocking' ? '✕ Blocking' : '○ Needs attention'} · {i.kind.replace(/_/g, ' ')}
              </p>
              <h3 id={`rc-${i.id}`} className="mt-1 font-semibold">
                {i.title}
              </h3>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {i.facts.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {i.operationId ? <p className="mt-1 text-xs text-ink-soft">Operation {i.operationId}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {i.action.href ? (
                  <GuardedLink
                    href={i.action.href}
                    className={
                      i.severity === 'blocking'
                        ? 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border-2 border-block bg-block-soft px-4 py-2 text-sm font-medium text-block hover:bg-block-soft/70'
                        : buttonClass('primary')
                    }
                  >
                    {i.action.label}
                  </GuardedLink>
                ) : (
                  <span className="text-sm text-ink-soft">Next step: {i.action.label.toLowerCase()}.</span>
                )}
                <button type="button" className={buttonClass()} onClick={() => dismiss(i.id)}>
                  Dismiss as reviewed
                </button>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}
