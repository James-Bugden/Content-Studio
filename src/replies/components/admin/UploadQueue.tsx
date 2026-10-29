'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button, Card, Meta, StatusLine } from '@/replies/components/replies/primitives';
import { BANK_ADMIN } from '@/replies/lib/workspace/copy';
import { BANK_IMAGE_MAX_BYTES, UPLOAD_REFUSAL, validateBankUpload } from '@/replies/lib/images/validate';
import { ApiError } from '@/replies/lib/workspace/client';
import { adminApi } from './adminApi';

/**
 * The review rows under the drop zone (#246).
 *
 * Every chosen file becomes one row. Files are checked one at a time (size, then
 * magic bytes) before anything is sent. A good file gets editable title, alt text
 * and tags, plus the optional AI suggestion. Save sends that one file once with a
 * request key that is reused if Save is pressed again; Save all does the same for
 * every ready row, one after another. A wrong or too-large file shows why and can
 * be dismissed.
 */

type RowState = 'checking' | 'ready' | 'saving' | 'refused';

interface Row {
  id: string;
  file: File;
  state: RowState;
  previewUrl: string | null;
  title: string;
  alt: string;
  tags: string;
  hint: string;
  note: string | null;
  error: string | null;
  suggesting: boolean;
}

function problem(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.envelope.code === 'monthly_ai_limit_reached') return BANK_ADMIN.limit;
    if (error.envelope.code === 'version_conflict') return BANK_ADMIN.conflict;
    if (error.envelope.code === 'not_configured') return BANK_ADMIN.notSetUp;
    return error.envelope.message;
  }
  return fallback;
}

const titleFromName = (name: string) => name.replace(/\.[A-Za-z0-9]+$/, '').replace(/[-_]+/g, ' ').trim();

export interface UploadQueueProps {
  /** Files handed over by the drop zone. Each new array is appended to the queue. */
  incoming: { batch: number; files: File[] } | null;
  /** Called after at least one image was saved, once the list can be refreshed. */
  onSaved(count: number): Promise<void>;
}

export function UploadQueue({ incoming, onSaved }: UploadQueueProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const keys = useRef(new Map<string, { save?: string; suggest?: string }>());
  const previews = useRef(new Map<string, string>());
  const seenBatch = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const [savingAll, setSavingAll] = useState(false);

  function patch(id: string, changes: Partial<Row>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...changes } : row)));
  }

  function drop(id: string) {
    const url = previews.current.get(id);
    if (url) URL.revokeObjectURL(url);
    previews.current.delete(id);
    keys.current.delete(id);
    setRows((current) => current.filter((row) => row.id !== id));
  }

  useEffect(
    () => () => {
      previews.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  // Check new files one at a time, in the order they were chosen.
  useEffect(() => {
    if (!incoming || incoming.batch === seenBatch.current) return;
    seenBatch.current = incoming.batch;
    const added: Row[] = incoming.files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      state: 'checking',
      previewUrl: null,
      title: titleFromName(file.name),
      alt: '',
      tags: '',
      hint: '',
      note: null,
      error: null,
      suggesting: false,
    }));
    setRows((current) => [...current, ...added]);
    for (const row of added) {
      chain.current = chain.current.then(async () => {
        // The server checks again. This only refuses a wrong file before a 5 MB upload.
        if (row.file.size > BANK_IMAGE_MAX_BYTES) {
          patch(row.id, { state: 'refused', error: UPLOAD_REFUSAL.too_large });
          return;
        }
        const bytes = new Uint8Array(await row.file.arrayBuffer());
        const verdict = validateBankUpload({ bytes, declaredType: row.file.type });
        if (!verdict.ok) {
          patch(row.id, { state: 'refused', error: UPLOAD_REFUSAL[verdict.reason] });
          return;
        }
        const url = URL.createObjectURL(row.file);
        previews.current.set(row.id, url);
        patch(row.id, { state: 'ready', previewUrl: url });
      });
    }
  }, [incoming]);

  async function suggest(row: Row) {
    patch(row.id, { suggesting: true, error: null, note: null });
    const entry = keys.current.get(row.id) ?? {};
    entry.suggest ??= crypto.randomUUID();
    keys.current.set(row.id, entry);
    try {
      const result = await adminApi.suggestImageMeta({
        request_key: entry.suggest,
        file_name: row.file.name.slice(0, 200),
        ...(row.hint.trim() ? { hint: row.hint.trim() } : {}),
      });
      entry.suggest = undefined;
      patch(row.id, {
        title: result.title,
        alt: result.alt_text,
        tags: result.tags.join(', '),
        note: BANK_ADMIN.suggested,
      });
    } catch (caught) {
      patch(row.id, { error: problem(caught, BANK_ADMIN.notSetUp) });
    } finally {
      patch(row.id, { suggesting: false });
    }
  }

  /** Returns true when the row was saved and removed. */
  async function upload(row: Row): Promise<boolean> {
    patch(row.id, { state: 'saving', error: null });
    const entry = keys.current.get(row.id) ?? {};
    entry.save ??= crypto.randomUUID();
    keys.current.set(row.id, entry);
    const form = new FormData();
    form.set('file', row.file);
    form.set('request_key', entry.save);
    form.set('title', row.title);
    form.set('alt_text', row.alt);
    form.set('tags', row.tags);
    try {
      await adminApi.uploadImage(form);
      drop(row.id);
      return true;
    } catch (caught) {
      patch(row.id, { state: 'ready', error: problem(caught, BANK_ADMIN.saveFailed) });
      return false;
    }
  }

  async function saveOne(row: Row) {
    if (await upload(row)) await onSaved(1);
  }

  async function saveAll() {
    setSavingAll(true);
    let saved = 0;
    for (const row of rows) {
      if (row.state !== 'ready' || row.title.trim() === '') continue;
      if (await upload(row)) saved += 1;
    }
    setSavingAll(false);
    if (saved > 0) await onSaved(saved);
  }

  if (rows.length === 0) return null;

  const ready = rows.filter((row) => row.state === 'ready' && row.title.trim() !== '');

  return (
    <div className="mb-4 space-y-3" aria-label={BANK_ADMIN.pending} role="group">
      {rows.map((row) => (
        <ReviewRow
          key={row.id}
          row={row}
          disabled={savingAll}
          onChange={(changes) => patch(row.id, changes)}
          onSuggest={() => void suggest(row)}
          onSave={() => void saveOne(row)}
          onSkip={() => drop(row.id)}
        />
      ))}
      {rows.length > 1 ? (
        <Button variant="primary" size="primary" disabled={savingAll || ready.length === 0} onClick={() => void saveAll()}>
          {savingAll ? BANK_ADMIN.saving : BANK_ADMIN.saveAll}
        </Button>
      ) : null}
    </div>
  );
}

function ReviewRow({
  row,
  disabled,
  onChange,
  onSuggest,
  onSave,
  onSkip,
}: {
  row: Row;
  disabled: boolean;
  onChange(changes: Partial<Row>): void;
  onSuggest(): void;
  onSave(): void;
  onSkip(): void;
}) {
  const titleId = useId();
  const altId = useId();
  const tagsId = useId();
  const hintId = useId();
  const fieldClass = 'w-full rounded-md border border-border-input bg-card px-3 py-2 text-meta';

  if (row.state === 'checking') {
    return (
      <Card>
        <Meta>
          {BANK_ADMIN.checking} <span className="[overflow-wrap:anywhere]">{row.file.name}</span>
        </Meta>
      </Card>
    );
  }

  if (row.state === 'refused') {
    return (
      <Card>
        <p className="text-meta font-medium [overflow-wrap:anywhere]">{row.file.name}</p>
        <StatusLine tone="error">{row.error}</StatusLine>
        <Button className="mt-2" variant="quiet" size="primary" onClick={onSkip}>
          {BANK_ADMIN.dismiss}
        </Button>
      </Card>
    );
  }

  const busy = row.state === 'saving' || disabled;

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row">
        {row.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local preview of the chosen file
          <img src={row.previewUrl} alt="" className="max-h-40 w-full rounded-md border border-hairline object-contain sm:w-40" />
        ) : null}
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <label htmlFor={titleId} className="mb-1 block text-meta font-medium">
              {BANK_ADMIN.title}
            </label>
            <input id={titleId} type="text" value={row.title} maxLength={200} onChange={(event) => onChange({ title: event.target.value })} className={fieldClass} />
          </div>
          <div>
            <label htmlFor={altId} className="mb-1 block text-meta font-medium">
              {BANK_ADMIN.altText}
            </label>
            <textarea
              id={altId}
              value={row.alt}
              rows={2}
              maxLength={500}
              onChange={(event) => onChange({ alt: event.target.value })}
              className="w-full resize-y rounded-md border border-border-input bg-card p-3 text-meta"
            />
          </div>
          <div>
            <label htmlFor={tagsId} className="mb-1 block text-meta font-medium">
              {BANK_ADMIN.tags}
            </label>
            <input id={tagsId} type="text" value={row.tags} onChange={(event) => onChange({ tags: event.target.value })} className={fieldClass} />
            <Meta className="mt-1">{BANK_ADMIN.tagsHint}</Meta>
          </div>
          <div>
            <label htmlFor={hintId} className="mb-1 block text-meta font-medium">
              {BANK_ADMIN.hint}
            </label>
            <input id={hintId} type="text" value={row.hint} maxLength={500} onChange={(event) => onChange({ hint: event.target.value })} className={fieldClass} />
            <Meta className="mt-1">{BANK_ADMIN.hintHelp}</Meta>
            <Button className="mt-2" disabled={row.suggesting || busy} onClick={onSuggest}>
              {row.suggesting ? BANK_ADMIN.suggesting : BANK_ADMIN.suggest}
            </Button>
            {row.note ? <StatusLine>{row.note}</StatusLine> : null}
          </div>
          {row.error ? <StatusLine tone="error">{row.error}</StatusLine> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="primary" disabled={busy || row.title.trim() === ''} onClick={onSave}>
              {row.state === 'saving' ? BANK_ADMIN.saving : BANK_ADMIN.save}
            </Button>
            <Button variant="quiet" size="primary" disabled={busy} onClick={onSkip}>
              {BANK_ADMIN.skip}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
