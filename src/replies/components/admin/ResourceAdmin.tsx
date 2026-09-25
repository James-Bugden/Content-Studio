'use client';

import { useId, useState } from 'react';
import { Button, Card, Meta, Pill, SectionHeading, StatusLine } from '@/replies/components/replies/primitives';
import { ADMIN } from '@/replies/lib/workspace/copy';
import { PLATFORM_LABELS, resourceOwnershipSchema, resourceTypeSchema, type Platform } from '@/replies/lib/contracts/vocabulary';
import type { AdminResource } from '@/replies/lib/server/store';
import { adminApi } from './adminApi';
import { ApiError } from '@/replies/lib/workspace/client';

/**
 * Resource registry administration (D06, D14).
 *
 * There is no delete here, only active/inactive, because a resource that was once
 * linked in a recorded reply has to stay resolvable for that reply's history even
 * after the owner stops offering it in new ones. `verified` is rendered but never
 * set from this form: it is not a claim this screen is in a position to make, so it
 * only ever shows what the registry already recorded.
 *
 * Every mutation re-fetches the list from the server rather than patching the local
 * copy optimistically. The registry's write rules are the store's to define, not
 * this component's to guess at, and showing a field as saved when it was not is
 * worse than a brief extra round trip.
 */

const PLATFORMS: Platform[] = ['linkedin', 'x', 'threads'];

interface FormState {
  type: (typeof resourceTypeSchema.options)[number];
  ownership: (typeof resourceOwnershipSchema.options)[number];
  title_en: string;
  title_zh_tw: string;
  description: string;
  tags: string;
  aliases: string;
  canonical_path: string;
  zh_tw_path: string;
  external_url: string;
  cta_en: string;
  cta_zh_tw: string;
  allowed_platforms: Set<Platform>;
  access_notes: string;
  active: boolean;
}

function blankForm(): FormState {
  return {
    type: 'guide',
    ownership: 'own',
    title_en: '',
    title_zh_tw: '',
    description: '',
    tags: '',
    aliases: '',
    canonical_path: '',
    zh_tw_path: '',
    external_url: '',
    cta_en: '',
    cta_zh_tw: '',
    allowed_platforms: new Set(PLATFORMS),
    access_notes: '',
    active: true,
  };
}

function formFromResource(resource: AdminResource): FormState {
  return {
    type: resource.type,
    ownership: resource.ownership,
    title_en: resource.title_en,
    title_zh_tw: resource.title_zh_tw ?? '',
    description: resource.description,
    tags: resource.tags.join(', '),
    aliases: resource.aliases.join(', '),
    canonical_path: resource.canonical_path ?? '',
    zh_tw_path: resource.zh_tw_path ?? '',
    external_url: resource.external_url ?? '',
    cta_en: resource.cta_en ?? '',
    cta_zh_tw: resource.cta_zh_tw ?? '',
    allowed_platforms: new Set(resource.allowed_platforms),
    access_notes: resource.access_notes ?? '',
    active: resource.active,
  };
}

const emptyToNull = (value: string) => (value.trim() === '' ? null : value.trim());
const csvToList = (value: string) =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

function toFields(form: FormState) {
  return {
    type: form.type,
    ownership: form.ownership,
    title_en: form.title_en.trim(),
    title_zh_tw: emptyToNull(form.title_zh_tw),
    description: form.description,
    tags: csvToList(form.tags),
    aliases: csvToList(form.aliases),
    canonical_path: emptyToNull(form.canonical_path),
    zh_tw_path: emptyToNull(form.zh_tw_path),
    external_url: emptyToNull(form.external_url),
    cta_en: emptyToNull(form.cta_en),
    cta_zh_tw: emptyToNull(form.cta_zh_tw),
    allowed_platforms: [...form.allowed_platforms],
    access_notes: emptyToNull(form.access_notes),
    active: form.active,
  };
}

function ResourceForm({
  initial,
  heading,
  onCancel,
  onSubmit,
}: {
  initial: FormState;
  heading: string;
  onCancel(): void;
  onSubmit(fields: ReturnType<typeof toFields>): Promise<void>;
}) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const titleId = useId();
  const titleZhId = useId();
  const descriptionId = useId();
  const tagsId = useId();
  const aliasesId = useId();
  const canonicalId = useId();
  const zhPathId = useId();
  const externalUrlId = useId();
  const ctaEnId = useId();
  const ctaZhId = useId();
  const accessNotesId = useId();

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await onSubmit(toFields(form));
    } catch (err) {
      setError(
        err instanceof ApiError && err.envelope.code === 'version_conflict'
          ? ADMIN.resources.conflict
          : err instanceof ApiError
            ? err.envelope.message
            : ADMIN.resources.saveFailed,
      );
    } finally {
      setSaving(false);
    }
  }

  function togglePlatform(platform: Platform) {
    setForm((current) => {
      const next = new Set(current.allowed_platforms);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return { ...current, allowed_platforms: next };
    });
  }

  return (
    <Card className="mb-4">
      <SectionHeading>{heading}</SectionHeading>

      <div className="space-y-3">
        <fieldset>
          <legend className="mb-1 text-meta font-medium">{ADMIN.resources.type}</legend>
          <select
            aria-label={ADMIN.resources.type}
            value={form.type}
            onChange={(event) => setForm({ ...form, type: event.target.value as FormState['type'] })}
            className="rounded-md border border-border-input bg-card px-3 py-2 text-meta"
          >
            {resourceTypeSchema.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-meta font-medium">{ADMIN.resources.ownership}</legend>
          <select
            aria-label={ADMIN.resources.ownership}
            value={form.ownership}
            onChange={(event) => setForm({ ...form, ownership: event.target.value as FormState['ownership'] })}
            className="rounded-md border border-border-input bg-card px-3 py-2 text-meta"
          >
            {resourceOwnershipSchema.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </fieldset>

        <div>
          <label htmlFor={titleId} className="mb-1 block text-meta font-medium">
            {ADMIN.resources.titleEn}
          </label>
          <input
            id={titleId}
            type="text"
            value={form.title_en}
            onChange={(event) => setForm({ ...form, title_en: event.target.value })}
            className="w-full rounded-md border border-border-input bg-card px-3 py-2 text-reply"
          />
        </div>

        <div>
          <label htmlFor={titleZhId} className="mb-1 block text-meta font-medium">
            {ADMIN.resources.titleZhTw}
          </label>
          <input
            id={titleZhId}
            type="text"
            lang="zh-TW"
            className="sr-cjk w-full rounded-md border border-border-input bg-card px-3 py-2 text-reply"
            value={form.title_zh_tw}
            onChange={(event) => setForm({ ...form, title_zh_tw: event.target.value })}
          />
        </div>

        <div>
          <label htmlFor={descriptionId} className="mb-1 block text-meta font-medium">
            {ADMIN.resources.description}
          </label>
          <textarea
            id={descriptionId}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            rows={3}
            className="w-full resize-y rounded-md border border-border-input bg-card p-3 text-meta"
          />
        </div>

        {form.ownership === 'own' ? (
          <>
            <div>
              <label htmlFor={canonicalId} className="mb-1 block text-meta font-medium">
                {ADMIN.resources.canonicalPath}
              </label>
              <input
                id={canonicalId}
                type="text"
                value={form.canonical_path}
                onChange={(event) => setForm({ ...form, canonical_path: event.target.value })}
                className="w-full rounded-md border border-border-input bg-card px-3 py-2 text-meta"
              />
            </div>
            <div>
              <label htmlFor={zhPathId} className="mb-1 block text-meta font-medium">
                {ADMIN.resources.zhTwPath}
              </label>
              <input
                id={zhPathId}
                type="text"
                value={form.zh_tw_path}
                onChange={(event) => setForm({ ...form, zh_tw_path: event.target.value })}
                className="w-full rounded-md border border-border-input bg-card px-3 py-2 text-meta"
              />
            </div>
          </>
        ) : (
          <div>
            <label htmlFor={externalUrlId} className="mb-1 block text-meta font-medium">
              {ADMIN.resources.externalUrl}
            </label>
            <input
              id={externalUrlId}
              type="url"
              value={form.external_url}
              onChange={(event) => setForm({ ...form, external_url: event.target.value })}
              className="w-full rounded-md border border-border-input bg-card px-3 py-2 text-meta"
            />
          </div>
        )}

        <div>
          <label htmlFor={ctaEnId} className="mb-1 block text-meta font-medium">
            {ADMIN.resources.ctaEn}
          </label>
          <input
            id={ctaEnId}
            type="text"
            value={form.cta_en}
            onChange={(event) => setForm({ ...form, cta_en: event.target.value })}
            className="w-full rounded-md border border-border-input bg-card px-3 py-2 text-meta"
          />
        </div>

        <div>
          <label htmlFor={ctaZhId} className="mb-1 block text-meta font-medium">
            {ADMIN.resources.ctaZhTw}
          </label>
          <input
            id={ctaZhId}
            type="text"
            lang="zh-TW"
            className="sr-cjk w-full rounded-md border border-border-input bg-card px-3 py-2 text-meta"
            value={form.cta_zh_tw}
            onChange={(event) => setForm({ ...form, cta_zh_tw: event.target.value })}
          />
        </div>

        <fieldset>
          <legend className="mb-1 text-meta font-medium">{ADMIN.resources.allowedPlatforms}</legend>
          <div className="flex flex-wrap gap-3">
            {PLATFORMS.map((platform) => (
              <label key={platform} className="flex items-center gap-1 text-meta">
                <input
                  type="checkbox"
                  checked={form.allowed_platforms.has(platform)}
                  onChange={() => togglePlatform(platform)}
                />
                {PLATFORM_LABELS[platform]}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor={tagsId} className="mb-1 block text-meta font-medium">
            {ADMIN.resources.tags}
          </label>
          <input
            id={tagsId}
            type="text"
            value={form.tags}
            onChange={(event) => setForm({ ...form, tags: event.target.value })}
            className="w-full rounded-md border border-border-input bg-card px-3 py-2 text-meta"
          />
        </div>

        <div>
          <label htmlFor={aliasesId} className="mb-1 block text-meta font-medium">
            {ADMIN.resources.aliases}
          </label>
          <input
            id={aliasesId}
            type="text"
            value={form.aliases}
            onChange={(event) => setForm({ ...form, aliases: event.target.value })}
            className="w-full rounded-md border border-border-input bg-card px-3 py-2 text-meta"
          />
        </div>

        <div>
          <label htmlFor={accessNotesId} className="mb-1 block text-meta font-medium">
            {ADMIN.resources.accessNotes}
          </label>
          <Meta className="mb-1">{ADMIN.resources.accessNotesHint}</Meta>
          <input
            id={accessNotesId}
            type="text"
            value={form.access_notes}
            onChange={(event) => setForm({ ...form, access_notes: event.target.value })}
            className="w-full rounded-md border border-border-input bg-card px-3 py-2 text-meta"
          />
        </div>

        <label className="flex items-center gap-2 text-meta">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(event) => setForm({ ...form, active: event.target.checked })}
          />
          {ADMIN.resources.active}
        </label>

        {error ? <StatusLine tone="error">{error}</StatusLine> : null}

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="primary" onClick={submit} disabled={saving}>
            {ADMIN.resources.save}
          </Button>
          <Button variant="quiet" onClick={onCancel}>
            {ADMIN.resources.cancel}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function ResourceAdmin({ initial }: { initial: AdminResource[] }) {
  const [items, setItems] = useState(initial);
  const [mode, setMode] = useState<'closed' | 'add' | 'edit'>('closed');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function refresh() {
    const { resources } = await adminApi.listResources();
    setItems(resources);
  }

  async function create(fields: ReturnType<typeof toFields>) {
    await adminApi.createResource(fields);
    await refresh();
    setMode('closed');
    setStatus(ADMIN.resources.saved);
  }

  async function update(resource: AdminResource, fields: ReturnType<typeof toFields>) {
    await adminApi.updateResource(resource.id, resource.version, fields);
    await refresh();
    setMode('closed');
    setEditingId(null);
    setStatus(ADMIN.resources.saved);
  }

  async function toggleActive(resource: AdminResource) {
    try {
      await adminApi.updateResource(resource.id, resource.version, { active: !resource.active });
      await refresh();
      setStatus(resource.active ? ADMIN.resources.disabled : ADMIN.resources.enabled);
    } catch {
      setStatus(ADMIN.resources.saveFailed);
    }
  }

  const editingResource = editingId ? items.find((r) => r.id === editingId) ?? null : null;

  return (
    <section aria-labelledby="resources-admin-heading">
      <SectionHeading id="resources-admin-heading">{ADMIN.resources.heading}</SectionHeading>
      <Meta className="mb-3">{ADMIN.resources.subheading}</Meta>

      {status ? <StatusLine>{status}</StatusLine> : null}

      {mode === 'add' ? (
        <ResourceForm
          initial={blankForm()}
          heading={ADMIN.resources.addTitle}
          onCancel={() => setMode('closed')}
          onSubmit={create}
        />
      ) : null}

      {mode === 'edit' && editingResource ? (
        <ResourceForm
          initial={formFromResource(editingResource)}
          heading={ADMIN.resources.editTitle}
          onCancel={() => {
            setMode('closed');
            setEditingId(null);
          }}
          onSubmit={(fields) => update(editingResource, fields)}
        />
      ) : null}

      {mode === 'closed' ? (
        <Button
          variant="primary"
          size="primary"
          className="mb-3"
          onClick={() => setMode('add')}
        >
          {ADMIN.resources.add}
        </Button>
      ) : null}

      {items.length === 0 ? (
        <StatusLine>{ADMIN.resources.empty}</StatusLine>
      ) : (
        <ul className="list-none p-0">
          {items.map((resource) => (
            <Card as="li" className="mb-2" key={resource.id}>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Pill>{resource.type}</Pill>
                <Pill tone={resource.verified ? 'green' : 'neutral'}>
                  {resource.verified ? ADMIN.resources.verified : ADMIN.resources.notVerified}
                </Pill>
                {!resource.active ? <Pill>{ADMIN.resources.inactiveLabel}</Pill> : null}
              </div>
              <p className="text-[0.9375rem] font-medium">{resource.title_en}</p>
              {resource.title_zh_tw ? (
                <p className="sr-cjk text-meta text-ink-soft" lang="zh-TW">
                  {resource.title_zh_tw}
                </p>
              ) : null}
              <Meta className="mt-1">
                {resource.allowed_platforms.map((p) => PLATFORM_LABELS[p]).join(', ')}
              </Meta>
              {/* Access wording only ever appears when the registry actually verified it. */}
              {resource.access_notes ? <Meta>{resource.access_notes}</Meta> : null}

              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditingId(resource.id);
                    setMode('edit');
                  }}
                >
                  {ADMIN.resources.edit}
                </Button>
                <Button variant="quiet" onClick={() => toggleActive(resource)}>
                  {resource.active ? ADMIN.resources.disable : ADMIN.resources.enable}
                </Button>
              </div>
            </Card>
          ))}
        </ul>
      )}
    </section>
  );
}

