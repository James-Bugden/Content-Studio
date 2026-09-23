import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { StateView } from '@/components/state-view';

/** Placeholder until CS-014 builds this surface (CS-006). Honest about what is not here yet. */
export const metadata: Metadata = { title: 'Schedule | Content Studio' };

export default function SchedulePage() {
  return (
    <>
      <PageHeader title="Schedule" description="Planned slots by platform, in Taipei time." />
      <StateView
        kind="empty"
        title="Coming in CS-014"
        detail="This view is not built yet. Nothing here reads or changes the Sheet, Drive or Typefully."
        nextStep={null}
      />
    </>
  );
}
