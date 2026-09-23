import type { Metadata } from 'next';
import { getServices } from '@/application/container';
import { loadAdaptationView } from '@/application/zh-view';
import { AdaptationWorkspace } from '@/components/adapt/adaptation-workspace';
import { ErrorState, GuardedLink, PageHeader } from '@/components';
import { isAppError } from '@/domain/errors';
import { contentIdSchema } from '@/domain/mutation';
import type { AdaptationView } from '@/domain/views';
import { requireActor } from '@/lib/auth';

export const metadata: Metadata = { title: 'Threads adaptation | Content Studio' };
export const dynamic = 'force-dynamic';

/** X to Threads zh-TW adaptation for one X Content ID (CS-011). */
export default async function AdaptPage({ params }: { params: Promise<{ contentId: string }> }) {
  const actor = await requireActor('viewer');
  const { contentId } = await params;
  const back = (
    <GuardedLink href="/schedule" className="text-sm underline">
      Back to the schedule
    </GuardedLink>
  );
  if (!contentIdSchema.safeParse(contentId).success) {
    return (
      <>
        <PageHeader title="Threads adaptation" actions={back} />
        <ErrorState code="NOT_FOUND" action={back} />
      </>
    );
  }
  let view: AdaptationView;
  try {
    view = await loadAdaptationView(getServices().repo, contentId);
  } catch (error) {
    return (
      <>
        <PageHeader title="Threads adaptation" actions={back} />
        <ErrorState code={isAppError(error) ? error.code : 'UNKNOWN'} action={back} />
      </>
    );
  }
  return (
    <>
      <PageHeader title="Threads adaptation" description={`${view.source.contentId} · X to Threads in Taiwan Traditional Chinese`} actions={back} />
      <div className="mt-4">
        <AdaptationWorkspace initial={view} canEdit={actor.role === 'owner'} />
      </div>
    </>
  );
}
