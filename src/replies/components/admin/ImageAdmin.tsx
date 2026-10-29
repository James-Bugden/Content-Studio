'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { TransferImage } from '@/components/image-transfer';
import { Button, Card, Meta, Pill, SectionHeading, StatusLine } from '@/replies/components/replies/primitives';
import { CreateImagePanel } from '@/replies/components/images/CreateImagePanel';
import { BANK_ADMIN } from '@/replies/lib/workspace/copy';
import { parseTagInput } from '@/replies/lib/images/tags';
import { ApiError } from '@/replies/lib/workspace/client';
import type { BankImage } from '@/replies/lib/contracts/api';
import { adminApi } from './adminApi';
import { ImageDropZone } from './ImageDropZone';
import { UploadQueue } from './UploadQueue';

/**
 * Image bank administration (#245).
 *
 * The same shape as the Facts and Resources pages: a list, an add form, an edit in
 * place, and a version on every change so a stale form cannot overwrite a newer one.
 *
 * Adding images (#246) starts at the drop zone (click, drop or paste). Each file gets
 * a review row in `UploadQueue`: a preview and, if asked, one small AI call proposes a
 * title, alt text and tags. All three are ordinary fields the owner edits before
 * pressing Save. Saving sends the file once, with a request key that is reused if
 * Save is pressed again.
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
  /** Server-provided: false when the image renderer has no secret or adapter. Never the secret itself. */
  rendererReady?: boolean;
}

export function ImageAdmin({ initial, rendererReady = true }: ImageAdminProps) {
  const [items, setItems] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [incoming, setIncoming] = useState<{ batch: number; files: File[] } | null>(null);
  const batch = useRef(0);
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

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <ImageDropZone
          onFiles={(files) => {
            setStatus(null);
            batch.current += 1;
            setIncoming({ batch: batch.current, files });
          }}
        />
        <div className="sm:w-60">
          <Button
            size="primary"
            className="w-full"
            disabled={!rendererReady || creating}
            aria-describedby="images-create-note"
            onClick={() => setCreating(true)}
          >
            {BANK_ADMIN.createWithAi}
          </Button>
          <Meta className="mt-1">
            <span id="images-create-note">{rendererReady ? BANK_ADMIN.createExplainer : BANK_ADMIN.rendererOff}</span>
          </Meta>
        </div>
      </div>

      <UploadQueue
        incoming={incoming}
        onSaved={async (count) => {
          await refresh();
          setStatus(count === 1 ? BANK_ADMIN.saved : BANK_ADMIN.savedMany(count));
        }}
      />

      {creating ? (
        <CreateImagePanel platform="linkedin" onClose={() => setCreating(false)} onCreated={() => void refresh()} />
      ) : null}

      {items.length === 0 ? (
        <StatusLine>{BANK_ADMIN.empty}</StatusLine>
      ) : (
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 lg:grid-cols-4">
          {items.map((image) => {
            if (editingId === image.id) {
              return (
                <li key={image.id} className="col-span-full">
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
              <Card as="li" key={image.id} className="min-w-0">
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
                  <div className="mt-2">
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
                      <Button variant="primary" size="primary" onClick={() => void remove(image)}>
                        {BANK_ADMIN.confirmYes}
                      </Button>
                      <Button variant="quiet" size="primary" onClick={() => setConfirmingId(null)}>
                        {BANK_ADMIN.cancel}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="primary"
                      onClick={() => {
                        setStatus(null);
                        setEditingId(image.id);
                      }}
                    >
                      {BANK_ADMIN.edit}
                    </Button>
                    <Button variant="quiet" size="primary" onClick={() => setConfirmingId(image.id)}>
                      {BANK_ADMIN.delete}
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </ul>
      )}
    </section>
  );
}
