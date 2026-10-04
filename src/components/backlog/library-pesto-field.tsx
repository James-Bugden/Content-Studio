'use client';

import { useState } from 'react';
import { newOperationId, postJson } from '@/lib/client/api';
import { PillarTag } from '../pillar-tag';
import { EditableTextCell, type TextCellSaveOutcome } from './editable-text-cell';

/**
 * PESTO stage on a Content Library post, edited in place (CS-054): the Posts
 * table and the post editor. Holds the row's Sheet revision so consecutive edits
 * each send the revision the last one produced; a post that changed in the Sheet
 * meanwhile is refused (STALE_READ) and nothing is written.
 */
type Outcome = { ok: true; pesto: string; revision: string; replayed: boolean } | { ok: false; code: string; message?: string };

export function LibraryPestoField({ libraryId, value, revision, canEdit, suggestions, onSaved }: {
  libraryId: string;
  value: string;
  revision: string;
  canEdit: boolean;
  suggestions?: readonly string[];
  /** Called with the new Sheet revision after a successful save. */
  onSaved?: (revision: string) => void;
}) {
  const [current, setCurrent] = useState({ value, revision });

  async function save(next: string): Promise<TextCellSaveOutcome> {
    const res = await postJson<Outcome>(`/api/library/${encodeURIComponent(libraryId)}/pesto`, {
      operationId: newOperationId('pesto'),
      libraryId,
      expectedRevision: current.revision,
      pesto: next,
    });
    const body = res.body as Outcome;
    if (body.ok) {
      setCurrent({ value: body.pesto, revision: body.revision });
      onSaved?.(body.revision);
      return { ok: true, note: body.replayed ? 'Already saved' : undefined };
    }
    if (body.code === 'STALE_READ') return { ok: false, message: 'This post changed in the Sheet. Reload to see the latest version, then try again.' };
    if (body.code === 'FORBIDDEN') return { ok: false, message: 'Not saved: this account cannot edit posts.' };
    return { ok: false, message: body.message || 'Not saved. Nothing was written.' };
  }

  return (
    <EditableTextCell
      value={current.value}
      canEdit={canEdit}
      libraryId={libraryId}
      fieldLabel="PESTO stage"
      placeholder="No PESTO stage"
      maxLength={200}
      suggestions={suggestions}
      displayValue={<PillarTag value={current.value} />}
      onSave={save}
    />
  );
}
