import type { Metadata } from 'next';
import { getServices } from '@/application/container';
import { previewPromotion, promotionContext, type PromotionContext, type PromotionPreview } from '@/application/schedule';
import { ErrorState, GateChip, GuardedLink, PageHeader, StateView } from '@/components';
import { PromoteConfirm } from '@/components/schedule/promote-confirm';
import { isAppError } from '@/domain/errors';
import { contentIdSchema, libraryIdSchema } from '@/domain/mutation';
import { requireActor } from '@/lib/auth';

export const metadata: Metadata = { title: 'Promote | Content Studio' };
export const dynamic = 'force-dynamic';

/**
 * Promotion preview (CS-013/CS-014). Pick an available slot, see every cell that
 * will be written with its before and after value, then confirm explicitly.
 */
export default async function PromotePage({
  params,
  searchParams,
}: {
  params: Promise<{ libraryId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActor('viewer');
  const { libraryId } = await params;
  const sp = await searchParams;
  const slot = typeof sp.slot === 'string' && contentIdSchema.safeParse(sp.slot).success ? sp.slot : null;
  const back = (
    <GuardedLink href="/ready" className="text-sm underline">
      Back to the ready queue
    </GuardedLink>
  );
  if (actor.role !== 'owner') return <ErrorState code="FORBIDDEN" action={back} />;
  if (!libraryIdSchema.safeParse(libraryId).success) return <ErrorState code="NOT_FOUND" action={back} />;

  const { repo } = getServices();
  let ctx: PromotionContext;
  try {
    ctx = await promotionContext(repo, libraryId);
  } catch (error) {
    return <ErrorState code={isAppError(error) ? error.code : 'UNKNOWN'} action={back} />;
  }
  let preview: PromotionPreview | null = null;
  if (slot) preview = await previewPromotion(repo, libraryId, slot);
  const item = ctx.library.value;

  return (
    <>
      <PageHeader title={`Promote ${item.slug || item.libraryId}`} description={`${item.targetPlatform.ok ? item.targetPlatform.value : 'Unknown platform'} · all times are Taipei`} actions={back} />
      <div className="mt-4 flex flex-col gap-5">
        {ctx.group !== 'ready' ? (
          <>
            <StateView
              kind={ctx.group === 'scheduled' ? 'conflict' : 'blocked'}
              title={ctx.group === 'scheduled' ? 'Already scheduled' : 'Not ready to schedule'}
              detail={ctx.group === 'scheduled' ? `Scheduled as ${ctx.alreadyScheduled.map((s) => s.contentId).join(', ')}.` : 'Every release gate must pass first.'}
              nextStep={null}
            />
            <ul className="flex flex-col gap-1.5">
              {ctx.gates.map((g, i) => (
                <li key={`${g.code}-${i}`}>
                  <GateChip gate={g} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <section aria-labelledby="slots-h">
              <h2 id="slots-h" className="text-lg font-semibold">
                Choose a slot
              </h2>
              {ctx.options.length === 0 ? (
                <p className="mt-2 text-sm text-ink-soft">No available slot rows in the next three weeks. Add slot rows in the Sheet first.</p>
              ) : (
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {ctx.options.map((o) => (
                    <li key={o.contentId}>
                      {o.ok ? (
                        <GuardedLink
                          href={`/ready/${encodeURIComponent(libraryId)}/promote?slot=${encodeURIComponent(o.contentId)}`}
                          aria-current={o.contentId === slot ? 'true' : undefined}
                          className={`flex min-h-11 flex-col rounded-md border px-3 py-2 text-sm ${o.contentId === slot ? 'border-primary bg-primary-soft' : 'border-line bg-card hover:border-ink'}`}
                        >
                          <span className="font-semibold">
                            {o.isoDate} · {o.slot} · {o.time}
                          </span>
                          <span className="font-mono text-xs">{o.contentId}</span>
                        </GuardedLink>
                      ) : (
                        <div className="rounded-md border border-dashed border-line px-3 py-2 text-sm text-ink-soft">
                          <span className="font-semibold">
                            {o.isoDate} · {o.slot}: not schedulable
                          </span>
                          <span className="block text-xs">{o.problems.join(' ')}</span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {preview ? (
              preview.ok ? (
                <section aria-labelledby="preview-h" className="flex flex-col gap-3">
                  <h2 id="preview-h" className="text-lg font-semibold">
                    What will be written to {preview.contentId}
                  </h2>
                  <p className="text-sm text-ink-soft">Only these cells change. Every other cell in the row, and every other row, is left as it is.</p>
                  <div tabIndex={0} role="region" aria-label="Cells to write (scrolls sideways)" className="overflow-x-auto rounded-lg border border-line bg-card">
                    <table className="w-full min-w-[36rem] text-left text-sm">
                      <caption className="sr-only">Cells to write</caption>
                      <thead className="bg-paper">
                        <tr>
                          <th scope="col" className="px-3 py-2">
                            Column
                          </th>
                          <th scope="col" className="px-3 py-2">
                            Now
                          </th>
                          <th scope="col" className="px-3 py-2">
                            After
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.preview.map((r) => (
                          <tr key={r.field} className="border-t border-line align-top">
                            <th scope="row" className="px-3 py-2 font-medium">
                              {r.header}
                            </th>
                            <td className="copy px-3 py-2 text-ink-soft">{r.before || '(empty)'}</td>
                            <td className="copy px-3 py-2">{r.after || '(empty)'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {actor.role === 'owner' ? (
                    <PromoteConfirm libraryId={libraryId} contentId={preview.contentId} libraryRevision={preview.libraryRevision} scheduleRevision={preview.scheduleRevision} />
                  ) : null}
                </section>
              ) : (
                <StateView kind="blocked" title="This slot cannot be used" detail={preview.problems.join(' ')} nextStep="Choose another slot." />
              )
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
