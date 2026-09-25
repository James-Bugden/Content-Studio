'use client';

import { useId, useState } from 'react';
import { Button, Card, Meta, Pill, ReplyText, SectionHeading, StatusLine } from '@/replies/components/replies/primitives';
import { ADMIN } from '@/replies/lib/workspace/copy';
import { factSensitivitySchema } from '@/replies/lib/contracts/vocabulary';
import type { AdminFact } from '@/replies/lib/server/store';
import { adminApi } from './adminApi';
import { ApiError } from '@/replies/lib/workspace/client';

/**
 * Fact bank administration (C06, D14).
 *
 * The one rule this screen exists to make impossible to miss: creating a fact
 * never approves it. The add form has no approval control at all, and the create
 * request always goes through unapproved regardless of what a form could send
 * (enforced again, server-side, in the route handler). A fact only becomes
 * eligible through an explicit edit, after the owner has actually read it back.
 *
 * Every row shows the real gate state rather than a single approved/not-approved
 * flag: a fact can be approved and active and still excluded because it is marked
 * private, and that is the state that most needs to stay visible, since a
 * private-only fact excluded from generation is easy to mistake for a bug rather
 * than the intended behaviour.
 */

const REASON_COPY: Readonly<Record<string, string>> = Object.freeze({
  not_approved: ADMIN.facts.reasonNotApproved,
  inactive: ADMIN.facts.reasonInactive,
  private_only: ADMIN.facts.reasonPrivate,
});

interface FormState {
  fact_text: string;
  tags: string;
  sensitivity: (typeof factSensitivitySchema.options)[number];
  active: boolean;
  valid_from: string;
  valid_to: string;
  approved: boolean;
}

function blankForm(): FormState {
  return {
    fact_text: '',
    tags: '',
    sensitivity: 'private_context_only',
    active: true,
    valid_from: '',
    valid_to: '',
    approved: false,
  };
}

function formFromFact(fact: AdminFact): FormState {
  return {
    fact_text: fact.fact_text,
    tags: fact.tags.join(', '),
    sensitivity: fact.sensitivity,
    active: fact.active,
    valid_from: fact.valid_from ?? '',
    valid_to: fact.valid_to ?? '',
    approved: fact.approved,
  };
}

const emptyToNull = (value: string) => (value.trim() === '' ? null : value.trim());
const csvToList = (value: string) =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

function toCreateFields(form: FormState) {
  return {
    fact_text: form.fact_text,
    tags: csvToList(form.tags),
    sensitivity: form.sensitivity,
    active: form.active,
    valid_from: emptyToNull(form.valid_from),
    valid_to: emptyToNull(form.valid_to),
  };
}

function toUpdateFields(form: FormState) {
  return {
    ...toCreateFields(form),
    approved: form.approved,
  };
}

function FactForm({
  initial,
  heading,
  isNew,
  onCancel,
  onSubmit,
}: {
  initial: FormState;
  heading: string;
  isNew: boolean;
  onCancel(): void;
  onSubmit(fields: ReturnType<typeof toUpdateFields>): Promise<void>;
}) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const factId = useId();
  const tagsId = useId();
  const validFromId = useId();
  const validToId = useId();

  const isChinese = /\p{Script=Han}/u.test(form.fact_text);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await onSubmit(toUpdateFields(form));
    } catch (err) {
      setError(
        err instanceof ApiError && err.envelope.code === 'version_conflict'
          ? ADMIN.facts.conflict
          : err instanceof ApiError
            ? err.envelope.message
            : ADMIN.facts.saveFailed,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-4">
      <SectionHeading>{heading}</SectionHeading>

      <div className="space-y-3">
        <div>
          <label htmlFor={factId} className="mb-1 block text-meta font-medium">
            {ADMIN.facts.factText}
          </label>
          <textarea
            id={factId}
            value={form.fact_text}
            onChange={(event) => setForm({ ...form, fact_text: event.target.value })}
            rows={3}
            className={isChinese ? 'sr-cjk w-full resize-y rounded-md border border-border-input bg-card p-3 text-reply' : 'w-full resize-y rounded-md border border-border-input bg-card p-3 text-reply'}
            {...(isChinese ? { lang: 'zh-TW' } : {})}
          />
        </div>

        <div>
          <label htmlFor={tagsId} className="mb-1 block text-meta font-medium">
            {ADMIN.facts.tags}
          </label>
          <input
            id={tagsId}
            type="text"
            value={form.tags}
            onChange={(event) => setForm({ ...form, tags: event.target.value })}
            className="w-full rounded-md border border-border-input bg-card px-3 py-2 text-meta"
          />
        </div>

        <fieldset>
          <legend className="mb-1 text-meta font-medium">{ADMIN.facts.sensitivity}</legend>
          <div role="radiogroup" aria-label={ADMIN.facts.sensitivity} className="flex flex-wrap gap-3">
            {factSensitivitySchema.options.map((option) => (
              <label key={option} className="flex items-center gap-1 text-meta">
                <input
                  type="radio"
                  name="sensitivity"
                  checked={form.sensitivity === option}
                  onChange={() => setForm({ ...form, sensitivity: option })}
                />
                {option === 'public_safe' ? ADMIN.facts.publicSafe : ADMIN.facts.privateOnly}
              </label>
            ))}
          </div>
          {form.sensitivity === 'private_context_only' ? (
            <Meta className="mt-1">{ADMIN.facts.privateOnlyHint}</Meta>
          ) : null}
        </fieldset>

        <div className="flex flex-wrap gap-3">
          <div>
            <label htmlFor={validFromId} className="mb-1 block text-meta font-medium">
              {ADMIN.facts.validFrom}
            </label>
            <input
              id={validFromId}
              type="date"
              value={form.valid_from}
              onChange={(event) => setForm({ ...form, valid_from: event.target.value })}
              className="rounded-md border border-border-input bg-card px-3 py-2 text-meta"
            />
          </div>
          <div>
            <label htmlFor={validToId} className="mb-1 block text-meta font-medium">
              {ADMIN.facts.validTo}
            </label>
            <input
              id={validToId}
              type="date"
              value={form.valid_to}
              onChange={(event) => setForm({ ...form, valid_to: event.target.value })}
              className="rounded-md border border-border-input bg-card px-3 py-2 text-meta"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-meta">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(event) => setForm({ ...form, active: event.target.checked })}
          />
          {ADMIN.facts.active}
        </label>

        {/* Approval is deliberately absent from the add form. A new fact is never
            approved by the act of creating it (C06). */}
        {isNew ? (
          <Meta>{ADMIN.facts.notApprovedYet}</Meta>
        ) : (
          <label className="flex items-center gap-2 text-meta">
            <input
              type="checkbox"
              checked={form.approved}
              onChange={(event) => setForm({ ...form, approved: event.target.checked })}
            />
            {ADMIN.facts.approved}
          </label>
        )}

        {error ? <StatusLine tone="error">{error}</StatusLine> : null}

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="primary" onClick={submit} disabled={saving}>
            {ADMIN.facts.save}
          </Button>
          <Button variant="quiet" onClick={onCancel}>
            {ADMIN.facts.cancel}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function FactAdmin({ initial }: { initial: AdminFact[] }) {
  const [items, setItems] = useState(initial);
  const [mode, setMode] = useState<'closed' | 'add' | 'edit'>('closed');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function refresh() {
    const { facts } = await adminApi.listFacts();
    setItems(facts);
  }

  async function create(fields: ReturnType<typeof toUpdateFields>) {
    // approved is stripped server-side regardless; not sent here at all.
    await adminApi.createFact(fields);
    await refresh();
    setMode('closed');
    setStatus(ADMIN.facts.saved);
  }

  async function update(fact: AdminFact, fields: ReturnType<typeof toUpdateFields>) {
    await adminApi.updateFact(fact.id, fact.version, fields);
    await refresh();
    setMode('closed');
    setEditingId(null);
    setStatus(ADMIN.facts.saved);
  }

  const editingFact = editingId ? items.find((f) => f.id === editingId) ?? null : null;

  return (
    <section aria-labelledby="facts-admin-heading">
      <SectionHeading id="facts-admin-heading">{ADMIN.facts.heading}</SectionHeading>
      <Meta className="mb-3">{ADMIN.facts.subheading}</Meta>

      {status ? <StatusLine>{status}</StatusLine> : null}

      {mode === 'add' ? (
        <FactForm
          initial={blankForm()}
          heading={ADMIN.facts.addTitle}
          isNew
          onCancel={() => setMode('closed')}
          onSubmit={create}
        />
      ) : null}

      {mode === 'edit' && editingFact ? (
        <FactForm
          initial={formFromFact(editingFact)}
          heading={ADMIN.facts.editTitle}
          isNew={false}
          onCancel={() => {
            setMode('closed');
            setEditingId(null);
          }}
          onSubmit={(fields) => update(editingFact, fields)}
        />
      ) : null}

      {mode === 'closed' ? (
        <Button variant="primary" size="primary" className="mb-3" onClick={() => setMode('add')}>
          {ADMIN.facts.add}
        </Button>
      ) : null}

      {items.length === 0 ? (
        <StatusLine>{ADMIN.facts.empty}</StatusLine>
      ) : (
        <ul className="list-none p-0">
          {items.map((fact) => {
            const isChinese = /\p{Script=Han}/u.test(fact.fact_text);
            return (
              <Card as="li" className="mb-2" key={fact.id}>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Pill tone={fact.sensitivity === 'public_safe' ? 'green' : 'neutral'}>
                    {fact.sensitivity === 'public_safe' ? ADMIN.facts.publicSafe : ADMIN.facts.privateOnly}
                  </Pill>
                  <Pill tone={fact.eligible ? 'green' : 'neutral'}>
                    {fact.eligible ? ADMIN.facts.eligible : ADMIN.facts.excluded}
                  </Pill>
                  {!fact.eligible && fact.ineligible_reason ? (
                    <Meta>{REASON_COPY[fact.ineligible_reason] ?? fact.ineligible_reason}</Meta>
                  ) : null}
                </div>

                <ReplyText text={fact.fact_text} chinese={isChinese} />

                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setEditingId(fact.id);
                      setMode('edit');
                    }}
                  >
                    {ADMIN.facts.edit}
                  </Button>
                </div>
              </Card>
            );
          })}
        </ul>
      )}
    </section>
  );
}

