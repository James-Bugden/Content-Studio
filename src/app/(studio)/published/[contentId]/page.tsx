import type { Metadata } from 'next';
import { getServices } from '@/application/container';
import { ErrorState, GuardedLink, PageHeader, StateView } from '@/components';
import { PublishedCard } from '@/components/published/published-card';
import { isAppError, type ErrorCode } from '@/domain/errors';
import { contentIdSchema } from '@/domain/mutation';
import type { ScheduleRecord } from '@/domain/records';
import { isPublishedRow, publishedRowView } from '@/domain/typefully-view';
import { requireActor } from '@/lib/auth';

export const metadata: Metadata = { title: 'Published post | Content Studio' };
export const dynamic = 'force-dynamic';

function currentTime(): number {
  return Date.now();
}

async function loadRow(contentId: string): Promise<{ ok: true; record: ScheduleRecord } | { ok: false; code: ErrorCode }> {
  if (!contentIdSchema.safeParse(contentId).success) return { ok: false, code: 'NOT_FOUND' };
  try {
    const schedule = await getServices().repo.listSchedule();
    const found = schedule.filter((r) => r.value.contentId === contentId);
    if (found.length !== 1) return { ok: false, code: found.length === 0 ? 'NOT_FOUND' : 'CONFLICT' };
    return { ok: true, record: found[0]! };
  } catch (error) {
    return { ok: false, code: isAppError(error) ? error.code : 'UNKNOWN' };
  }
}

/** One published row with exact Sheet values and its sync actions (CS-016 PUB-01). */
export default async function PublishedDetailPage({ params }: { params: Promise<{ contentId: string }> }) {
  const actor = await requireActor('viewer');
  const { contentId } = await params;
  const back = (
    <GuardedLink href="/published" className="text-sm underline">
      Back to Published
    </GuardedLink>
  );
  const loaded = await loadRow(contentId);
  if (!loaded.ok) {
    return (
      <>
        <PageHeader title="Published post" actions={back} />
        <ErrorState code={loaded.code} action={back} />
      </>
    );
  }
  const record = loaded.record;
  const row = publishedRowView(record.value, record.revision, currentTime());
  return (
    <>
      <PageHeader title={contentId} description={`${row.platformRaw || 'Unknown platform'} · published record from the Sheet. Times are Taipei.`} actions={back} />
      <div className="mt-4 flex flex-col gap-4">
        {!isPublishedRow(record.value) ? (
          <StateView kind="empty" title="Not published" detail={`Typefully Status is ${row.typefullyStatus} and no publish time or post link is recorded.`} nextStep={null} />
        ) : null}
        <PublishedCard row={row} canEdit={actor.role === 'owner'} detailLink={false} />
      </div>
    </>
  );
}
