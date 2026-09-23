import type { Metadata } from 'next';
import { getServices } from '@/application/container';
import { loadEditor } from '@/application/editor';
import { ErrorState, GateChip, GuardedLink, NextAction, PageHeader, StatusBadge } from '@/components';
import { PostEditor } from '@/components/editor/post-editor';
import { isAppError } from '@/domain/errors';
import { shortHash } from '@/domain/hash';
import { libraryIdSchema } from '@/domain/mutation';
import type { EditorModel } from '@/domain/views';
import { requireActor } from '@/lib/auth';

export const metadata: Metadata = { title: 'Editor | Content Studio' };
export const dynamic = 'force-dynamic';

/** Post Editor (CS-008): the Library row and its Markdown section side by side, with revisions. */
export default async function EditorPage({ params }: { params: Promise<{ libraryId: string }> }) {
  const actor = await requireActor('viewer');
  const { libraryId } = await params;
  const back = (
    <GuardedLink href="/review" className="text-sm underline">
      Back to the review queue
    </GuardedLink>
  );
  if (!libraryIdSchema.safeParse(libraryId).success) {
    return <ErrorState code="NOT_FOUND" action={back} />;
  }
  let model: EditorModel;
  try {
    const { repo, drive } = getServices();
    model = await loadEditor(repo, drive, libraryId);
  } catch (error) {
    return (
      <>
        <PageHeader title="Editor" actions={back} />
        <ErrorState code={isAppError(error) ? error.code : 'UNKNOWN'} action={back} />
      </>
    );
  }
  // Opaque, per-session namespace for tab-local recovery (SEC-11). Not an identifier.
  const ns = shortHash(`recovery:${actor.sub}:${actor.role}`);

  return (
    <>
      <PageHeader title={model.slug || model.libraryId} description={`${model.targetPlatform} · ${model.source}`} actions={back} />
      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="min-w-0">
          <PostEditor model={model} canEdit={actor.role === 'owner'} ns={ns} />
        </div>
        <aside aria-label="Status and sources" className="flex min-w-0 flex-col gap-4">
          <div className="rounded-lg border border-line bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Release gates</h2>
              <StatusBadge status={model.gates.status} />
            </div>
            <div className="mt-3">
              <NextAction gate={model.gates.next} />
            </div>
            <ul className="mt-3 flex flex-col gap-1.5">
              {[...model.gates.blockers, ...model.gates.warnings].map((g, i) => (
                <li key={`${g.code}-${i}`}>
                  <GateChip gate={g} />
                </li>
              ))}
            </ul>
          </div>
          <dl className="rounded-lg border border-line bg-card p-4 text-sm">
            <dt className="text-ink-soft">Library ID</dt>
            <dd className="font-mono">{model.libraryId}</dd>
            <dt className="mt-2 text-ink-soft">Current hook</dt>
            <dd className="copy">{model.sheet.hook || 'None yet'}</dd>
            <dt className="mt-2 text-ink-soft">Review status</dt>
            <dd>{model.reviewStatus === 'Pending' ? 'Not reviewed' : model.reviewStatus}</dd>
            <dt className="mt-2 text-ink-soft">Visual</dt>
            <dd>{model.visual}</dd>
            <dt className="mt-2 text-ink-soft">Sheet revision</dt>
            <dd className="font-mono text-xs">{model.sheet.revision}</dd>
            <dt className="mt-2 text-ink-soft">Markdown</dt>
            <dd className="text-xs">
              {model.markdown.state === 'ok' ? (
                <>
                  <span className="font-mono">rev {model.markdown.fileRevision}</span> · modified {new Date(model.markdown.modifiedTime).toLocaleString('en-GB', { timeZone: 'Asia/Taipei' })} Taipei
                </>
              ) : (
                <>Unavailable ({model.markdown.reason.replace(/_/g, ' ')})</>
              )}
            </dd>
          </dl>
        </aside>
      </div>
    </>
  );
}
