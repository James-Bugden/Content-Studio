'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SlotPanelData } from '@/domain/board';
import { buttonClass } from '../button-styles';
import { GuardedLink } from '../guarded-link';
import { InlineResult } from '../inline-result';
import { PromoteConfirm } from '../schedule/promote-confirm';
import { StateView } from '../state-view';
import { TypefullyPanel } from '../typefully/typefully-panel';
import { OpenPanelLink } from './open-panel-link';
import { PlatformPreview } from './platform-preview';
import { PostThumb } from './post-thumb';
import { ZhInline } from './zh-inline';

/**
 * Schedule slot side panel (UX redesign). An open slot offers the Ready posts
 * for its platform with an exact preview and an explicit confirm; a filled slot
 * shows how it will read, its image, the next step, the Threads adaptation and
 * the Typefully state, all without leaving the calendar.
 */
type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; data: SlotPanelData };
type Preview = { ok: true; contentId: string; libraryRevision: string; scheduleRevision: string; preview: { field: string; header: string; after: string }[] } | { ok: false; problems?: string[]; message?: string };

function dayLabel(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

export function SlotPanel({ contentId }: { contentId: string }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [picked, setPicked] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/panel/slot/${encodeURIComponent(contentId)}`, { credentials: 'same-origin' });
    const body = (await res.json().catch(() => null)) as { ok: boolean; data?: SlotPanelData; message?: string } | null;
    if (!res.ok || !body?.ok || !body.data) {
      setLoad({ state: 'error', message: body?.message ?? 'This slot could not be loaded. Nothing was changed.' });
      return;
    }
    setLoad({ state: 'ok', data: body.data });
  }, [contentId]);

  useEffect(() => {
    queueMicrotask(() => void refresh());
  }, [refresh]);

  if (load.state === 'loading') return <StateView kind="loading" title="Loading the slot" />;
  if (load.state === 'error') return <StateView kind="provider_error" title="Could not open this slot" detail={load.message} />;
  const { slot, copy, typefully, typefullyError, candidates, canEdit } = load.data;
  const step = slot.step;
  const text = slot.platform === 'Threads' ? copy.chineseContent || copy.hook : copy.content || copy.hook;

  async function choose(libraryId: string) {
    setPicked(libraryId);
    setPreview(null);
    const res = await fetch(`/api/schedule/promote/preview?libraryId=${encodeURIComponent(libraryId)}&contentId=${encodeURIComponent(contentId)}`, { credentials: 'same-origin' });
    setPreview((await res.json().catch(() => ({ ok: false }))) as Preview);
  }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h2 id="panel-title" className="text-lg font-semibold">
          {slot.platform} {slot.slot} · {slot.time}
        </h2>
        <p className="text-sm text-ink-soft">
          {dayLabel(slot.isoDate)} · Taipei time · {slot.statusLabel}{slot.expectedPillar ? <> · {slot.expectedPillar}</> : null}
        </p>
      </header>

      <section aria-label="Next step" className={`rounded-lg border p-3 ${step.urgency === 'now' ? 'border-block bg-block-soft' : 'border-line bg-card'}`}>
        <p className="text-sm">
          <span className="rounded bg-primary-soft px-1.5 py-0.5 text-xs font-semibold text-primary">Next</span>{' '}
          <strong>
            {step.action}
          </strong>
          <span className="text-ink-soft">: {step.why}</span>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">

          {slot.libraryId ? (
            <OpenPanelLink target={{ post: slot.libraryId }} className={buttonClass()}>
              Open the post
            </OpenPanelLink>
          ) : null}
          {slot.platform === 'Threads' && slot.parentContentId ? (
            <OpenPanelLink target={{ slot: slot.parentContentId }} className={buttonClass()}>
              Open the X post
            </OpenPanelLink>
          ) : null}
        </div>
      </section>

      {step.kind === 'translate' || step.kind === 'update_chinese' || step.kind === 'review_chinese' ? (
        <section aria-labelledby="zh-h" className="rounded-lg border border-line bg-card p-3">
          <h3 id="zh-h" className="mb-2 font-semibold">
            Threads version (zh-TW)
          </h3>
          <ZhInline xContentId={slot.platform === 'Threads' && slot.parentContentId ? slot.parentContentId : contentId} canEdit={canEdit} />
        </section>
      ) : null}

      {slot.empty && slot.platform !== 'Threads' ? (
        <section aria-labelledby="fill-h" className="rounded-lg border border-line bg-card p-3">
          <h3 id="fill-h" className="font-semibold">
            Fill this slot
          </h3>
          {!canEdit ? (
            <p className="mt-1 text-sm text-ink-soft">Read-only access.</p>
          ) : candidates.length === 0 ? (
            <p className="mt-1 text-sm text-ink-soft">No {slot.platform} posts are Ready yet. Approve and queue one in Posts first.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {candidates.map((p) => (
                <li key={p.libraryId} className={`flex items-center gap-3 rounded-md border p-2 ${picked === p.libraryId ? 'border-ink' : 'border-line'}`}>
                  <PostThumb thumb={p.thumb} size="sm" showLabel={false} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium first-letter:uppercase">{p.title}</p>
                    <p className="line-clamp-1 text-xs text-ink-soft">{p.hook}</p>
                  </div>
                  <button type="button" className={buttonClass(picked === p.libraryId ? 'primary' : 'secondary')} onClick={() => void choose(p.libraryId)}>
                    Use this
                  </button>
                </li>
              ))}
            </ul>
          )}
          {preview ? (
            preview.ok ? (
              <div className="mt-3 flex flex-col gap-2">
                <p className="text-sm text-ink-soft">These cells will be written to the Schedule. Nothing else changes.</p>
                <ul className="text-sm">
                  {preview.preview.map((r) => (
                    <li key={r.field} className="flex gap-2 border-t border-line py-1">
                      <span className="w-40 shrink-0 font-medium">{r.header}</span>
                      <span className="copy line-clamp-2 min-w-0">{r.after || '(empty)'}</span>
                    </li>
                  ))}
                </ul>
                {picked ? <PromoteConfirm libraryId={picked} contentId={contentId} libraryRevision={preview.libraryRevision} scheduleRevision={preview.scheduleRevision} /> : null}
              </div>
            ) : (
              <div className="mt-3">
                <InlineResult tone="warning">{preview.problems?.join(' ') || preview.message || 'This post cannot go into this slot.'}</InlineResult>
              </div>
            )
          ) : null}
        </section>
      ) : null}

      {!slot.empty ? (
        <>
          <PlatformPreview platform={slot.platform} text={text} thumb={slot.thumb} />
          {copy.finalContent && copy.finalContent !== text ? (
            <details className="rounded-lg border border-line bg-card p-3 text-sm">
              <summary className="cursor-pointer font-medium">Final copy from Typefully differs</summary>
              <p className="copy mt-2">{copy.finalContent}</p>
            </details>
          ) : null}
          <section aria-label="Typefully">
            {typefully ? (
              <TypefullyPanel initial={typefully} canEdit={canEdit} />
            ) : (
              <StateView kind="provider_error" title="Typefully state unavailable" detail={`Review and scheduling still work. (${typefullyError ?? 'unknown'})`} nextStep="Try again in a moment." />
            )}
          </section>
        </>
      ) : null}

      <details className="text-sm">
        <summary className="cursor-pointer text-ink-soft">Details</summary>
        <dl className="mt-2 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt className="text-ink-soft">Content ID</dt>
          <dd className="font-mono">{slot.contentId}</dd>
          {slot.parentContentId ? (
            <>
              <dt className="text-ink-soft">From X post</dt>
              <dd className="font-mono">{slot.parentContentId}</dd>
            </>
          ) : null}
          <dt className="text-ink-soft">Library post</dt>
          <dd className="font-mono">{slot.libraryId ?? 'None'}</dd>
        </dl>
        <GuardedLink href={`/schedule/${encodeURIComponent(contentId)}`} className="mt-2 inline-block underline">
          Open the full slot page
        </GuardedLink>
      </details>
    </div>
  );
}
