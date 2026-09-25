import { resolvePageSession, loadProgress, PageShell, SignedOutPage } from '@/replies/components/admin/session';
import { LibrarySearch } from '@/replies/components/admin/LibrarySearch';

export const dynamic = 'force-dynamic';

/**
 * The library (D05, D14, SEC-05, UTIL-01).
 *
 * All the search and correction behaviour lives in `LibrarySearch`, a client
 * component, because search is stateful and the request itself must be a POST so
 * the owner's private text never touches a URL. This file only resolves who is
 * asking and renders the header the rest of the app shares.
 */
export default async function LibraryPage() {
  const session = await resolvePageSession();
  if (!session) return <SignedOutPage />;

  const progress = await loadProgress(session);

  return (
    <PageShell progress={progress}>
      <LibrarySearch />
    </PageShell>
  );
}

