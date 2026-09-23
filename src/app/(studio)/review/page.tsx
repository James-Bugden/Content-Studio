import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { StateView } from '@/components/state-view';

/** Placeholder until CS-007 builds this surface (CS-006). Honest about what is not here yet. */
export const metadata: Metadata = { title: 'Review | Content Studio' };

export default function ReviewPage() {
  return (
    <>
      <PageHeader title="Review queue" description="Check drafts, hooks and QA flags, then approve or request changes." />
      <StateView
        kind="empty"
        title="Coming in CS-007"
        detail="This view is not built yet. Nothing here reads or changes the Sheet, Drive or Typefully."
        nextStep={null}
      />
    </>
  );
}
