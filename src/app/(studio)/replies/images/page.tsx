import { getStore } from '@/replies/lib/server/get-store';
import { resolvePageSession, loadProgress, PageShell, SignedOutPage } from '@/replies/components/admin/session';
import { ImageAdmin } from '@/replies/components/admin/ImageAdmin';
import { toBankImage } from '@/replies/lib/images/bank-image';

export const dynamic = 'force-dynamic';

/**
 * The image bank (#245).
 *
 * Same shape as the Facts and Resources pages: the server reads the list once for
 * the first paint (without any bytes), and `ImageAdmin` owns every change after that.
 */
export default async function ImagesPage() {
  const session = await resolvePageSession();
  if (!session) return <SignedOutPage />;

  const store = getStore(session);
  const [progress, rows] = await Promise.all([loadProgress(session), store.listBankImages()]);

  return (
    <PageShell progress={progress}>
      <ImageAdmin initial={rows.map(toBankImage)} />
    </PageShell>
  );
}
