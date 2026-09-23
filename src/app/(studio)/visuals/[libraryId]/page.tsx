import type { Metadata } from 'next';
import { getServices } from '@/application/container';
import { loadVisualItem } from '@/application/visuals';
import { ErrorState, GuardedLink, PageHeader, StateView } from '@/components';
import { VisualEditor } from '@/components/visuals/visual-editor';
import { isAppError } from '@/domain/errors';
import { libraryIdSchema } from '@/domain/mutation';
import type { VisualItemView } from '@/domain/visual-studio';
import { requireActor } from '@/lib/auth';

export const metadata: Metadata = { title: 'Visual | Content Studio' };
export const dynamic = 'force-dynamic';

/** One item's visual: decision, brief, render and exact-revision approval (CS-012). */
export default async function VisualItemPage({ params }: { params: Promise<{ libraryId: string }> }) {
  const actor = await requireActor('viewer');
  const { libraryId } = await params;
  const back = (
    <GuardedLink href="/visuals" className="text-sm underline">
      Back to visual studio
    </GuardedLink>
  );
  if (!libraryIdSchema.safeParse(libraryId).success) return <ErrorState code="NOT_FOUND" action={back} />;
  let loaded: { item: VisualItemView; scheduleUnavailable: boolean };
  try {
    loaded = await loadVisualItem(getServices().repo, libraryId);
  } catch (error) {
    return (
      <>
        <PageHeader title="Visual" actions={back} />
        <ErrorState code={isAppError(error) ? error.code : 'UNKNOWN'} action={back} />
      </>
    );
  }
  const { item, scheduleUnavailable } = loaded;
  return (
    <>
      <PageHeader title={item.slug || item.libraryId} description={`Visual for ${item.platformLabel} · ${item.libraryId}`} actions={back} />
      {scheduleUnavailable ? (
        <div className="mb-4">
          <StateView
            kind="provider_error"
            title="Content Schedule could not be read"
            detail="Screenshot reuse cannot be confirmed, so screenshot decisions stay blocked until it can."
            nextStep="Reload in a moment."
          />
        </div>
      ) : null}
      <VisualEditor initial={item} canEdit={actor.role === 'owner'} />
    </>
  );
}
