import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { StateView } from '@/components/state-view';

/** Placeholder until CS-012 builds this surface (CS-006). Honest about what is not here yet. */
export const metadata: Metadata = { title: 'Visuals | Content Studio' };

export default function VisualsPage() {
  return (
    <>
      <PageHeader title="Visual studio" description="Decide the visual for each post and approve the exact asset revision." />
      <StateView
        kind="empty"
        title="Coming in CS-012"
        detail="This view is not built yet. Nothing here reads or changes the Sheet, Drive or Typefully."
        nextStep={null}
      />
    </>
  );
}
