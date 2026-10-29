import { Suspense } from 'react';
import type { SlowSection } from '@/application/reconcile';
import { StateView } from '../state-view';
import { ReconcileList } from './reconcile-list';
import { SectionError, SectionSkeleton } from './section-status';

export type SectionProps = { id: string; title: string; what: string; source: string; clear: string; promise: Promise<SlowSection> };

/**
 * One slow check as its own streamed section. A rejection or a failed provider
 * call stays inside this section; the page and the other section are unaffected.
 */
export async function Section({ id, title, what, source, clear, promise }: SectionProps) {
  let result: SlowSection | null = null;
  try {
    result = await promise;
  } catch {
    result = null;
  }
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-lg font-semibold">
        {title}
        {result ? <span className="ml-2 text-sm font-normal text-ink-soft">({result.items.length})</span> : null}
      </h2>
      <div className="mt-2 flex flex-col gap-3">
        {!result ? <SectionError what={source} /> : null}
        {result && result.failed > 0 ? <SectionError what={source} detail={`${result.failed} of ${result.checked} ${what} could not be read in time.`} /> : null}
        {result && result.items.length > 0 ? <ReconcileList items={result.items} /> : null}
        {result && result.items.length === 0 && result.failed === 0 ? <StateView kind="empty" title={clear} nextStep={null} /> : null}
      </div>
    </section>
  );
}

function Streamed(props: SectionProps) {
  return (
    <Suspense fallback={<SectionSkeleton id={props.id} title={props.title} what={props.source} />}>
      <Section {...props} />
    </Suspense>
  );
}

export function DriveSection({ promise }: { promise: Promise<SlowSection> }) {
  return <Streamed id="drive-check-h" title="Drive Markdown vs database" what="Drive files" source="Drive" clear="Drive matches the database" promise={promise} />;
}

export function TypefullySection({ promise }: { promise: Promise<SlowSection> }) {
  return <Streamed id="typefully-check-h" title="Typefully drafts" what="Typefully lookups" source="Typefully" clear="No Typefully drafts need review" promise={promise} />;
}
