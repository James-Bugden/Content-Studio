'use client';

import { useEffect, useState } from 'react';
import type { SlotPanelData } from '@/domain/board';
import { InlineResult } from '../inline-result';
import { StateView } from '../state-view';
import { TypefullyPanel } from '../typefully/typefully-panel';

/**
 * Typefully step shown inline right after a post is scheduled (#247). It reuses the
 * slot panel's own Typefully panel (create, push, link and the Chinese Threads
 * adaptation blocker with its link), loaded from the same slot panel API, so the
 * guards, idempotency and wording are exactly those of the slot panel.
 */
type Load = { state: 'loading' } | { state: 'error' } | { state: 'ok'; data: SlotPanelData };

export function ScheduledTypefully({ contentId }: { contentId: string }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  useEffect(() => {
    let active = true;
    void (async () => {
      const res = await fetch(`/api/panel/slot/${encodeURIComponent(contentId)}`, { credentials: 'same-origin' }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as { ok: boolean; data?: SlotPanelData } | null;
      if (active) setLoad(res?.ok && body?.ok && body.data ? { state: 'ok', data: body.data } : { state: 'error' });
    })();
    return () => { active = false; };
  }, [contentId]);

  if (load.state === 'loading') return <StateView kind="loading" title="Loading Typefully" />;
  if (load.state === 'error' || !load.data.typefully) {
    return <InlineResult tone="warning">Typefully could not be checked. Scheduling is done; open the slot to create the draft.</InlineResult>;
  }
  const { slot, typefully, canEdit } = load.data;
  return (
    <div className="flex flex-col gap-2" data-testid="scheduled-typefully">
      <p className="text-sm">
        <span className="font-semibold">{slot.platform} {slot.slot}</span> · {slot.time} · {slot.statusLabel}
      </p>
      <TypefullyPanel initial={typefully} canEdit={canEdit} />
    </div>
  );
}
