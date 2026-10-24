import { PageHeader } from './page-header';
import { StateView } from './state-view';

/** Shared route fallback using the existing loading state and surface tokens. */
export function RouteLoading({ title }: { title: string }) {
  return <>
    <PageHeader title={title} />
    <StateView kind="loading" />
    <div aria-hidden="true" className="mt-4 flex flex-col gap-3 motion-safe:animate-pulse">
      {Array.from({ length: 4 }, (_, i) => <div key={i} className="rounded-lg border border-line bg-card p-4">
        <div className="h-4 w-1/3 rounded bg-primary-soft" />
        <div className="mt-3 h-3 w-2/3 rounded bg-primary-soft" />
      </div>)}
    </div>
  </>;
}
