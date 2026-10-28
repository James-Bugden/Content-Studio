'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { TransferImage } from '@/components/image-transfer';
import { Button, Card, Meta, Pill, SectionHeading, StatusLine } from '@/replies/components/replies/primitives';
import { CreateImagePanel } from '@/replies/components/images/CreateImagePanel';
import { BANK_ADMIN, IMAGE_SUGGESTIONS } from '@/replies/lib/workspace/copy';
import { parseTagInput } from '@/replies/lib/images/tags';
import { BANK_IMAGE_MAX_BYTES, UPLOAD_REFUSAL, validateBankUpload } from '@/replies/lib/images/validate';
import { ApiError } from '@/replies/lib/workspace/client';
import type { BankImage } from '@/replies/lib/contracts/api';
import { adminApi } from './adminApi';

/**
 * Image bank administration (#245).
 *
 * The same shape as the Facts and Resources pages: a list, an add form, an edit in
 * place, and a version on every change so a stale form cannot overwrite a newer one.
 *
 * Adding an image is two steps the owner stays in charge of. Choosing a file shows a
 * preview and, if asked, one small AI call proposes a title, alt text and tags. All
 * three are ordinary fields the owner edits before pressing Save. Saving sends the
 * file once, with a request key that is reused if Save is pressed again.
 */

function problem(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.envelope.code === 'monthly_ai_limit_reached') return BANK_ADMIN.limit;
    if (error.envelope.code === 'version_conflict') return BANK_ADMIN.conflict;
    if (error.envelope.code === 'not_configured') return BANK_ADMIN.notSetUp;
    return error.envelope.message;
  }
  return fallback;
}

function AddForm({ onSaved, onCancel }: { onSaved(): Promise<void>; onCancel(): void }) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [alt, setAlt] = useState('');
  const [tags, setTags] = useState('');
  const [hint, setHint] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  /** One key per Save attempt, kept until it succeeds, so a repeat is a replay. */
  const saveKey = useRef<string | null>(null);
  const suggestKey = useRef<string | null>(null);
  const fileId = useId();
  const titleId = useId();
  const altId = useId();
  const tagsId = useId();
  const hintId = useId();

  useEffect(() => {
    document.getElementById(fileId)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The object URL for the chosen file's local preview, released when replaced. */
  const preview = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (preview.current) URL.revokeObjectURL(preview.current);
    },
    [],
  );

  function showPreview(next: File | null) {
    if (preview.current) URL.revokeObjectURL(preview.current);
    preview.current = next ? URL.createObjectURL(next) : null;
    setPreviewUrl(preview.current);
  }

  async function choose(next: File | null) {
    setError(null);
    setNote(null);
    saveKey.current = null;
    suggestKey.current = null;
    if (!next) {
      setFile(null);
      showPreview(null);
      return;
    }
    // The server checks again. This is only so a wrong file is refused before a
    // 5 MB upload rather than after it.
    const bytes = new Uint8Array(await next.arrayBuffer());
    const verdict = validateBankUpload({ bytes, declaredType: next.type });
    if (!verdict.ok) {
      setFile(null);
      showPreview(null);
      setError(UPLOAD_REFUSAL[verdict.reason]);
      return;
    }
    setFile(next);
    showPreview(next);
    if (!title) setTitle(next.name.replace(/\.[A-Za-z0-9]+$/, '').replace(/[-_]+/g, ' ').trim());
  }

  async function suggest() {
    if (!file) return;
    setSuggesting(true);
    setError(null);
    setNote(null);
    suggestKey.current ??= crypto.randomUUID();
    try {
      const result = await adminApi.suggestImageMeta({
        request_key: suggestKey.current,
        file_name: file.name.slice(0, 200),
        ...(hint.trim() ? { hint: hint.trim() } : {}),
      });
      suggestKey.current = null;
      setTitle(result.title);
      setAlt(result.alt_text);
      setTags(result.tags.join(', '));
      setNote(BANK_ADMIN.suggested);
    } catch (caught) {
      setError(problem(caught, BANK_ADMIN.notSetUp));
    } finally {
      setSuggesting(false);
    }
  }

  async function save() {
    if (!file) {
      setError(BANK_ADMIN.chooseFile);
      return;
    }
    setSaving(true);
    setError(null);
    saveKey.current ??= crypto.randomUUID();
    const form = new FormData();
    form.set('file', file);
    form.set('request_key', saveKey.current);
    form.set('title', title);
    form.set('alt_text', alt);
    form.set('tags', tags);
    try {
      await adminApi.uploadImage(form);
      saveKey.current = null;
      await onSaved();
    } catch (caught) {
      setError(problem(caught, BANK_ADMIN.saveFailed));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-4">
      <SectionHeading>{BANK_ADMIN.addTitle}</SectionHeading>
      <div className="space-y-3">
        <div>
          <label htmlFor={fileId} className="mb-1 block text-meta font-medium">
            {BANK_ADMIN.file}
          </label>
          <input
            id={fileId}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => void choose(event.target.files?.[0] ?? null)}
            className="block w-full text-meta"
          />
          <Meta className="mt-1">{BANK_ADMIN.subheading}</Meta>
        </div>

        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local preview of the chosen file
          <img src={previewUrl} alt="" className="max-h-48 max-w-full rounded-md border border-hairline object-contain" />
        ) : null}

        <div>
          <label htmlFor={hintId} className="mb-1 block text-meta font-medium">
            {BANK_ADMIN.hint}
          </label>
          <input
            id={hintId}
            type="text"
            value={hint}
            maxLength={500}
            onChange={(event) => setHint(event.target.value)}
            className="w-full rounded-md border border-border-input bg-card px-3 py-2 text-meta"
          />
          <Meta className="mt-1">{BANK_ADMIN.hintHelp}</Meta>
          <Button className="mt-2" disabled={!file || suggesting} onClick={() => void suggest()}>
            {suggesting ? BANK_ADMIN.suggesting : BANK_ADMIN.suggest}
          </Button>
          {note ? <StatusLine>{note}</StatusLine> : null}
        </div>

        <div>
          <label htmlFor={titleId} className="mb-1 block text-meta font-medium">
            {BANK_ADMIN.title}
          </label>
          <input
            id={titleId}
            type="text"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-md border border-border-input bg-card px-3 py-2 text-meta"
          />
        </div>
        <div>
          <label htmlFor={altId} className="mb-1 block text-meta font-medium">
            {BANK_ADMIN.altText}
          </label>
          <textarea
            id={altId}
            value={alt}
            rows={2}
            maxLength={500}
            onChange={(event) => setAlt(event.target.value)}
            className="w-full resize-y rounded-md border border-border-input bg-card p-3 text-meta"
          />
        </div>
        <div>
          <label htmlFor={tagsId} className="mb-1 block text-meta font-medium">
            {BANK_ADMIN.tags}
          </label>
          <input
            id={tagsId}
            type="text"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            className="w-full rounded-md border border-border-input bg-card px-3 py-2 text-meta"
          />
          <Meta className="mt-1">{BANK_ADMIN.tagsHint}</Meta>
        </div>

        {error ? <StatusLine tone="error">{error}</StatusLine> : null}

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="primary" disabled={saving || !file || title.trim() === ''} onClick={() => void save()}>
            {saving ? BANK_ADMIN.saving : BANK_ADMIN.save}
          </Button>
          <Button variant="quiet" onClick={onCancel}>
            {BANK_ADMIN.cancel}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function EditForm({
  image,
  onSaved,
  onCancel,
}: {
  image: BankImage;
  onSaved(): Promise<void>;
  onCancel(): void;
}) {
  const [title, setTitle] = useState(image.title);
  const [alt, setAlt] = useState(image.alt_text);
  const [tags, setTags] = useState(image.tags.join(', '));
  const [active, setActive] = useState(image.active);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const key = useRef<string | null>(null);
  const titleId = useId();
  const altId = useId();
  const tagsId = useId();

  useEffect(() => {
    document.getElementById(titleId)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    key.current ??= crypto.randomUUID();
    try {
      await adminApi.updateImage(image.id, image.version, key.current, {
        title,
        alt_text: alt,
        tags: parseTagInput(tags),
        active,
      });
      key.current = null;
      await onSaved();
    } catch (caught) {
      setError(problem(caught, BANK_ADMIN.saveFailed));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-4">
      <SectionHeading>{BANK_ADMIN.editTitle}</SectionHeading>
      <div className="space-y-3">
        <div>
          <label htmlFor={titleId} className="mb-1 block text-meta font-medium">
            {BANK_ADMIN.title}
          </label>
          <input
            id={titleId}
            type="text"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-md border border-border-input bg-card px-3 py-2 text-meta"
          />
        </div>
        <div>
          <label htmlFor={altId} className="mb-1 block text-meta font-medium">
            {BANK_ADMIN.altText}
          </label>
          <textarea
            id={altId}
            value={alt}
            rows={2}
            maxLength={500}
            onChange={(event) => setAlt(event.target.value)}
            className="w-full resize-y rounded-md border border-border-input bg-card p-3 text-meta"
          />
        </div>
        <div>
          <label htmlFor={tagsId} className="mb-1 block text-meta font-medium">
            {BANK_ADMIN.tags}
          </label>
          <input
            id={tagsId}
            type="text"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            className="w-full rounded-md border border-border-input bg-card px-3 py-2 text-meta"
          />
          <Meta className="mt-1">{BANK_ADMIN.tagsHint}</Meta>
        </div>
        <label className="flex items-center gap-2 text-meta">
          <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
          {BANK_ADMIN.active}
        </label>

        {error ? <StatusLine tone="error">{error}</StatusLine> : null}

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="primary" disabled={saving || title.trim() === ''} onClick={() => void save()}>
            {saving ? BANK_ADMIN.saving : BANK_ADMIN.save}
          </Button>
          <Button variant="quiet" onClick={onCancel}>
            {BANK_ADMIN.cancel}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export interface ImageAdminProps {
  initial: BankImage[];
}

export function ImageAdmin({ initial }: ImageAdminProps) {
  const [items, setItems] = useState(initial);
  const [mode, setMode] = useState<'closed' | 'add' | 'create'>('closed');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const deleteKey = useRef<string | null>(null);

  async function refresh() {
    const { images } = await adminApi.listImages();
    setItems(images);
  }

  async function remove(image: BankImage) {
    setError(null);
    deleteKey.current ??= crypto.randomUUID();
    try {
      await adminApi.deleteImage(image.id, image.version, deleteKey.current);
      deleteKey.current = null;
      setConfirmingId(null);
      await refresh();
      setStatus(BANK_ADMIN.deleted);
    } catch (caught) {
      setError(problem(caught, BANK_ADMIN.saveFailed));
    }
  }

  return (
    <section aria-labelledby="images-admin-heading">
      <SectionHeading id="images-admin-heading">{BANK_ADMIN.heading}</SectionHeading>
      <Meta className="mb-3">{BANK_ADMIN.subheading}</Meta>

      {status ? <StatusLine>{status}</StatusLine> : null}
      {error ? <StatusLine tone="error">{error}</StatusLine> : null}

      {mode === 'add' ? (
        <AddForm
          onCancel={() => setMode('closed')}
          onSaved={async () => {
            await refresh();
            setMode('closed');
            setStatus(BANK_ADMIN.saved);
          }}
        />
      ) : null}

      {mode === 'create' ? (
        <CreateImagePanel
          platform="linkedin"
          onClose={() => setMode('closed')}
          onCreated={() => void refresh()}
        />
      ) : null}

      {mode === 'closed' ? (
        <div className="mb-3 flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="primary"
            onClick={() => {
              setStatus(null);
              setMode('add');
            }}
          >
            {BANK_ADMIN.add}
          </Button>
          <Button size="primary" onClick={() => setMode('create')}>
            {IMAGE_SUGGESTIONS.createNew}
          </Button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <StatusLine>{BANK_ADMIN.empty}</StatusLine>
      ) : (
        <ul className="m-0 list-none p-0">
          {items.map((image) => {
            if (editingId === image.id) {
              return (
                <li key={image.id}>
                  <EditForm
                    image={image}
                    onCancel={() => setEditingId(null)}
                    onSaved={async () => {
                      await refresh();
                      setEditingId(null);
                      setStatus(BANK_ADMIN.saved);
                    }}
                  />
                </li>
              );
            }
            return (
              <Card as="li" key={image.id} className="mb-2">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  {image.origin === 'created' ? <Pill>{BANK_ADMIN.createdTag}</Pill> : null}
                  {image.status === 'sketch' ? (
                    <Pill>{image.sketch_approved ? BANK_ADMIN.sketchApproved : BANK_ADMIN.sketchState}</Pill>
                  ) : null}
                  {!image.active ? <Pill>Off</Pill> : null}
                </div>
                <p className="text-[0.9375rem] font-medium [overflow-wrap:anywhere]">{image.title}</p>
                {image.alt_text ? <Meta className="mt-1">{image.alt_text}</Meta> : null}
                {image.tags.length > 0 ? <Meta className="mt-1">{image.tags.join(', ')}</Meta> : null}

                {image.url ? (
                  <div className="mt-2 max-w-[320px]">
                    <TransferImage
                      src={image.url}
                      alt={image.alt_text}
                      filename={image.title}
                      contentId={image.id}
                      loading="lazy"
                      className="max-h-48 w-full rounded-md object-contain"
                    />
                  </div>
                ) : null}

                {confirmingId === image.id ? (
                  <div className="mt-2" role="alert">
                    <StatusLine>{BANK_ADMIN.confirmDelete}</StatusLine>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <Button variant="primary" onClick={() => void remove(image)}>
                        {BANK_ADMIN.confirmYes}
                      </Button>
                      <Button variant="quiet" onClick={() => setConfirmingId(null)}>
                        {BANK_ADMIN.cancel}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      onClick={() => {
                        setStatus(null);
                        setEditingId(image.id);
                      }}
                    >
                      {BANK_ADMIN.edit}
                    </Button>
                    <Button variant="quiet" onClick={() => setConfirmingId(image.id)}>
                      {BANK_ADMIN.delete}
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </ul>
      )}
      <Meta className="mt-3">Largest upload: {Math.round(BANK_IMAGE_MAX_BYTES / (1024 * 1024))} MB.</Meta>
    </section>
  );
}
