import { getStore } from '@/replies/lib/server/get-store';
import { resolvePageSession, loadProgress, PageShell, SignedOutPage } from '@/replies/components/admin/session';
import { ResourceAdmin } from '@/replies/components/admin/ResourceAdmin';

export const dynamic = 'force-dynamic';

/**
 * The resource registry (D06, D14, UTIL-01).
 *
 * The initial list is read straight from the store on the server, the same way
 * the workspace reads its opening progress, so the first paint already shows real
 * rows rather than an empty list that corrects itself a moment later. Every
 * mutation after that goes through `ResourceAdmin`, a client component.
 */
export default async function ResourcesPage() {
  const session = await resolvePageSession();
  if (!session) return <SignedOutPage />;

  const store = getStore(session);
  const [progress, resources] = await Promise.all([loadProgress(session), store.listResources()]);

  return (
    <PageShell progress={progress}>
      <ResourceAdmin initial={resources} />
    </PageShell>
  );
}

