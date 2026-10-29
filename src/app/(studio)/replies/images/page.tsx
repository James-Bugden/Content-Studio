import { getStore } from '@/replies/lib/server/get-store';
import { resolvePageSession, loadProgress, PageShell, SignedOutPage } from '@/replies/components/admin/session';
import { ImageAdmin } from '@/replies/components/admin/ImageAdmin';
import { serverEnv } from '@/lib/env';
import { toBankImage } from '@/replies/lib/images/bank-image';

export const dynamic = 'force-dynamic';

/**
 * True when "Create with AI" can render: the fake adapter, or a live renderer with
 * its secret and base URL set. Only this boolean reaches the browser, never the secret.
 */
function rendererReady(): boolean {
  const env = serverEnv();
  return env.CS_DATA_MODE === 'fake' || Boolean(env.IMAGE_RENDERER_SECRET && env.APP_BASE_URL);
}

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
      <ImageAdmin initial={rows.map(toBankImage)} rendererReady={rendererReady()} />
    </PageShell>
  );
}
