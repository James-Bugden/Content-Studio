/**
 * Route-transition skeleton for every studio page (CS-045). Each page does a
 * fresh Sheet read before it renders, so without this a click looks frozen.
 * Purely visual: a polite status for assistive tech, no data and no copy that
 * could be mistaken for real content.
 */
export default function StudioLoading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading the latest version from the Sheet</span>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <div className="h-6 w-40 animate-pulse rounded bg-line/70 motion-reduce:animate-none" />
        <div className="h-4 w-72 max-w-full animate-pulse rounded bg-line/50 motion-reduce:animate-none" />
      </div>
      <ul aria-hidden="true" className="divide-y divide-line rounded-lg border border-line bg-card">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="flex items-center gap-3 px-3 py-3">
            <span className="size-2 rounded-full bg-line" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="h-3.5 w-1/2 animate-pulse rounded bg-line/70 motion-reduce:animate-none" />
              <div className="h-3 w-3/4 animate-pulse rounded bg-line/40 motion-reduce:animate-none" />
            </div>
            <div className="h-8 w-24 rounded-md border border-line" />
          </li>
        ))}
      </ul>
    </div>
  );
}
