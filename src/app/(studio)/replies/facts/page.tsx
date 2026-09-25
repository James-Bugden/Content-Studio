import { getStore } from '@/replies/lib/server/get-store';
import { resolvePageSession, loadProgress, PageShell, SignedOutPage } from '@/replies/components/admin/session';
import { FactAdmin } from '@/replies/components/admin/FactAdmin';

export const dynamic = 'force-dynamic';

/**
 * The fact bank (C06, D14, UTIL-01).
 *
 * Same shape as the resources page: the server reads the current list once for the
 * first paint, and `FactAdmin` owns every mutation after that.
 */
export default async function FactsPage() {
  const session = await resolvePageSession();
  if (!session) return <SignedOutPage />;

  const store = getStore(session);
  const [progress, facts] = await Promise.all([loadProgress(session), store.listFacts()]);

  return (
    <PageShell progress={progress}>
      <FactAdmin initial={facts} />
    </PageShell>
  );
}

