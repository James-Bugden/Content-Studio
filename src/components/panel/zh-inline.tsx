'use client';

import { useEffect, useState } from 'react';
import type { AdaptationView } from '@/domain/views';
import { AdaptationWorkspace } from '../adapt/adaptation-workspace';
import { StateView } from '../state-view';

/**
 * The X to Threads zh-TW adaptation, inside the slot panel (UX redesign), so
 * translating and reviewing Chinese does not need another page. It is the same
 * workspace and the same guarded APIs as `/schedule/<id>/adapt`.
 */
export function ZhInline({ xContentId, canEdit }: { xContentId: string; canEdit: boolean }) {
  const [view, setView] = useState<AdaptationView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const res = await fetch(`/api/schedule/${encodeURIComponent(xContentId)}/zh`, { credentials: 'same-origin' });
      const body = (await res.json().catch(() => null)) as { ok: boolean; view?: AdaptationView; message?: string } | null;
      if (!live) return;
      if (res.ok && body?.ok && body.view) setView(body.view);
      else setError(body?.message ?? 'The Threads version could not be loaded.');
    })();
    return () => {
      live = false;
    };
  }, [xContentId]);

  if (error) return <StateView kind="provider_error" title="Threads version unavailable" detail={error} />;
  if (!view) return <StateView kind="loading" title="Loading the Threads version" />;
  return <AdaptationWorkspace initial={view} canEdit={canEdit} />;
}
