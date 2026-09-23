import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { StateView } from '@/components/state-view';

/** Placeholder until CS-017 builds this surface (CS-006). Honest about what is not here yet. */
export const metadata: Metadata = { title: 'Reconcile | Content Studio' };

export default function ReconcilePage() {
  return (
    <>
      <PageHeader title="Reconcile" description="Compare the Sheet with Typefully and choose which way to sync." />
      <StateView
        kind="empty"
        title="Coming in CS-017"
        detail="This view is not built yet. Nothing here reads or changes the Sheet, Drive or Typefully."
        nextStep={null}
      />
    </>
  );
}
