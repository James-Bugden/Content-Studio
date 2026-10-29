'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { buttonClass } from '../button-styles';
import { StateView } from '../state-view';

/** Placeholder while one slow check runs; the rest of the page is already usable. */
export function SectionSkeleton({ id, title, what }: { id: string; title: string; what: string }) {
  return (
    <section aria-labelledby={id} aria-busy="true">
      <h2 id={id} className="text-lg font-semibold">{title}</h2>
      <div role="status" className="mt-2 rounded-lg border border-line bg-card p-4">
        <p className="text-sm text-ink-soft">Checking {what}. The rest of this page is ready.</p>
        <div aria-hidden="true" className="mt-3 flex flex-col gap-2 motion-safe:animate-pulse">
          <div className="h-4 w-1/3 rounded bg-primary-soft" />
          <div className="h-3 w-2/3 rounded bg-primary-soft" />
        </div>
      </div>
    </section>
  );
}

/**
 * One check could not complete. The banner keeps the page-wide wording, then says which source, that the result is unknown
 * rather than clear, and offers a fresh re-check that skips the short result cache.
 */
export function SectionError({ what, detail }: { what: string; detail?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <StateView
      kind="provider_error"
      title="Some sources could not be read"
      detail={`Couldn't check ${what}. ${detail ? `${detail} ` : ''}Unknown, not clear. Everything else on this page is unaffected.`}
      nextStep={null}
      action={
        // A link, not a button: re-checking only re-reads, and the sweep treats links as safe navigation.
        <a
          href="/reconcile?fresh=1"
          className={buttonClass('secondary')}
          aria-disabled={pending}
          onClick={(e) => {
            e.preventDefault();
            if (!pending) start(() => router.replace(`/reconcile?fresh=${Date.now()}`));
          }}
        >
          {pending ? 'Retrying…' : 'Retry'}
        </a>
      }
    />
  );
}
