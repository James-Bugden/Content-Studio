import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { StateView } from '@/components/state-view';

/** Placeholder until CS-013 builds this surface (CS-006). Honest about what is not here yet. */
export const metadata: Metadata = { title: 'Ready | Content Studio' };

export default function ReadyPage() {
  return (
    <>
      <PageHeader title="Ready queue" description="Items that pass every release gate and can move to the schedule." />
      <StateView
        kind="empty"
        title="Coming in CS-013"
        detail="This view is not built yet. Nothing here reads or changes the Sheet, Drive or Typefully."
        nextStep={null}
      />
    </>
  );
}
