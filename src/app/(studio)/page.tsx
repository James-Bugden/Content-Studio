import { StatusBanner } from '@/components/shell-status';
import type { Metadata } from 'next';
import { getServices } from '@/application/container';
import { loadBoard, type Board } from '@/application/board';
import { capabilities } from '@/application/capabilities';
import { CapabilityBanner, ErrorState, PageHeader } from '@/components';
import { NextUpView } from '@/components/home/next-up-view';
import { isAppError } from '@/domain/errors';
import { requireActor } from '@/lib/auth';

export const metadata: Metadata = { title: 'Next up | Content Studio' };
export const dynamic = 'force-dynamic';

/**
 * Next up (UX redesign): the home page. One board read; anonymous visitors are
 * sent to /login by the studio layout (SEC-05) and requireActor checks again.
 */
export default async function NextUpPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  await requireActor('viewer');
  const params = await searchParams;
  const page = (key: string) => {
    const value = Number(params[key]);
    return Number.isSafeInteger(value) && value > 0 ? value : 1;
  };
  let board: Board;
  try {
    board = await loadBoard(getServices().repo, { requireSchedule: true });
  } catch (error) {
    return (
      <>
        <PageHeader title="Next up" />
        <StatusBanner kind="capability"><CapabilityBanner capabilities={capabilities()} /></StatusBanner>
        <ErrorState code={isAppError(error) ? error.code : 'UNKNOWN'} />
      </>
    );
  }
  return <NextUpView today={board.today} counts={board.counts} tasks={board.tasks} posts={board.posts} slots={board.slots} nowPage={page('nowPage')} nextPage={page('nextPage')} integrationStatus={<StatusBanner kind="capability"><CapabilityBanner capabilities={capabilities()} /></StatusBanner>} />;
}
