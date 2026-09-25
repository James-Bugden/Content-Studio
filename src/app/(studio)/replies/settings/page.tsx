import { getStore } from '@/replies/lib/server/get-store';
import { configurationStatus } from '@/replies/lib/config/env';
import { resolvePageSession, loadProgress, PageShell, SignedOutPage } from '@/replies/components/admin/session';
import { SettingsForm } from '@/replies/components/admin/SettingsForm';

export const dynamic = 'force-dynamic';

/**
 * Settings (C10, D14, UTIL-01).
 *
 * `configurationStatus()` is read here, server-side, and passed down as the plain
 * names-and-states object it already is. Nothing upstream of this file ever holds
 * a key or a service-role value, so there is nothing this page could leak even by
 * a rendering mistake.
 */
export default async function SettingsPage() {
  const session = await resolvePageSession();
  if (!session) return <SignedOutPage />;

  const store = getStore(session);
  const [progress, settings] = await Promise.all([loadProgress(session), store.getSettings()]);
  const status = configurationStatus();

  return (
    <PageShell progress={progress}>
      <SettingsForm initial={settings} status={status} />
    </PageShell>
  );
}
