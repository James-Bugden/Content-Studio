import type { Metadata } from 'next';
import { getServices } from '@/application/container';
import { loadBoard, type Board } from '@/application/board';
import { ErrorState, PageHeader } from '@/components';
import { NextUpView } from '@/components/home/next-up-view';
import { isAppError } from '@/domain/errors';
import { requireActor } from '@/lib/auth';

export const metadata: Metadata = { title: 'Next up | Content Studio' };
export const dynamic = 'force-dynamic';

/**
 * Next up (UX redesign): the home page. One board read; anonymous visitors are
 * sent to /login by the studio layout (SEC-05) and requireActor checks again.
 */
export default async function NextUpPage() {
  await requireActor('viewer');
  let board: Board;
  try {
    board = await loadBoard(getServices().repo);
  } catch (error) {
    return (
      <>
        <PageHeader title="Next up" description="Here is what needs you" />
        <ErrorState code={isAppError(error) ? error.code : 'UNKNOWN'} />
      </>
    );
  }
  return <NextUpView today={board.today} counts={board.counts} tasks={board.tasks} posts={board.posts} />;
}
