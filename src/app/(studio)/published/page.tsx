import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { StateView } from '@/components/state-view';

/** Placeholder until CS-016 builds this surface (CS-006). Honest about what is not here yet. */
export const metadata: Metadata = { title: 'Published | Content Studio' };

export default function PublishedPage() {
  return (
    <>
      <PageHeader title="Published" description="Exact final copy, links and recorded metrics per platform." />
      <StateView
        kind="empty"
        title="Coming in CS-016"
        detail="This view is not built yet. Nothing here reads or changes the Sheet, Drive or Typefully."
        nextStep={null}
      />
    </>
  );
}
