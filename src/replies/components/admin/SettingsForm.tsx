'use client';

import { useId, useState } from 'react';
import { Button, Card, Meta, Pill, SectionHeading, StatusLine } from '@/replies/components/replies/primitives';
import { SETTINGS } from '@/replies/lib/workspace/copy';
import type { AdminSettings } from '@/replies/lib/server/store';
import type { configurationStatus } from '@/replies/lib/config/env';
import { adminApi } from './adminApi';

/**
 * Settings (C10, SR-018).
 *
 * The configuration block renders exactly what `configurationStatus()` returns:
 * names and states. There is nowhere in this component that reads or displays an
 * API key, a service-role value or a model name a person could copy into a prompt
 * to a live provider; the type of `status` below does not even carry those fields,
 * so there is nothing to accidentally print.
 */

type ConfigStatus = ReturnType<typeof configurationStatus>;

function modeLabel(mode: 'fake' | 'live' | 'unconfigured'): string {
  if (mode === 'live') return SETTINGS.live;
  if (mode === 'fake') return SETTINGS.fakeMode;
  return SETTINGS.unconfigured;
}

function stateLabel(state: 'configured' | 'missing'): string {
  return state === 'configured' ? SETTINGS.configured : SETTINGS.missing;
}

export function SettingsForm({ initial, status }: { initial: AdminSettings; status: ConfigStatus }) {
  const [form, setForm] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const linkedinId = useId();
  const xId = useId();
  const threadsId = useId();
  const timezoneId = useId();

  async function save() {
    setSaving(true);
    try {
      const saved = await adminApi.saveSettings(form);
      setForm(saved);
      setMessage(SETTINGS.saved);
    } catch {
      // The typed values stay in the form either way (C07).
      setMessage(SETTINGS.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <section aria-labelledby="settings-targets-heading" className="mb-6">
        <SectionHeading id="settings-targets-heading">{SETTINGS.targetsHeading}</SectionHeading>
        <Card>
          <div className="space-y-3">
            <div>
              <label htmlFor={linkedinId} className="mb-1 block text-meta font-medium">
                {SETTINGS.targetLinkedin}
              </label>
              <input
                id={linkedinId}
                type="number"
                min={0}
                max={100}
                value={form.target_linkedin}
                onChange={(event) => setForm({ ...form, target_linkedin: Number(event.target.value) })}
                className="w-24 rounded-md border border-border-input bg-card px-3 py-2 text-meta"
              />
            </div>
            <div>
              <label htmlFor={xId} className="mb-1 block text-meta font-medium">
                {SETTINGS.targetX}
              </label>
              <input
                id={xId}
                type="number"
                min={0}
                max={100}
                value={form.target_x}
                onChange={(event) => setForm({ ...form, target_x: Number(event.target.value) })}
                className="w-24 rounded-md border border-border-input bg-card px-3 py-2 text-meta"
              />
            </div>
            <div>
              <label htmlFor={threadsId} className="mb-1 block text-meta font-medium">
                {SETTINGS.targetThreads}
              </label>
              <input
                id={threadsId}
                type="number"
                min={0}
                max={100}
                value={form.target_threads}
                onChange={(event) => setForm({ ...form, target_threads: Number(event.target.value) })}
                className="w-24 rounded-md border border-border-input bg-card px-3 py-2 text-meta"
              />
            </div>
            <div>
              <label htmlFor={timezoneId} className="mb-1 block text-meta font-medium">
                {SETTINGS.timezone}
              </label>
              <input
                id={timezoneId}
                type="text"
                value={form.timezone}
                onChange={(event) => setForm({ ...form, timezone: event.target.value })}
                className="w-full max-w-xs rounded-md border border-border-input bg-card px-3 py-2 text-meta"
              />
            </div>

            {message ? <StatusLine>{message}</StatusLine> : null}

            <Button variant="primary" size="primary" onClick={save} disabled={saving}>
              {SETTINGS.save}
            </Button>
          </div>
        </Card>
      </section>

      <section aria-labelledby="settings-config-heading">
        <SectionHeading id="settings-config-heading">{SETTINGS.configHeading}</SectionHeading>
        <Meta className="mb-2">{SETTINGS.configHint}</Meta>
        <Card>
          <dl className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-meta text-ink-soft">{SETTINGS.authRow}</dt>
              <dd>
                <Pill tone={status.auth === 'configured' ? 'green' : 'neutral'}>{stateLabel(status.auth)}</Pill>
              </dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-meta text-ink-soft">{SETTINGS.generationRow}</dt>
              <dd>
                <Pill tone={status.generation === 'live' ? 'green' : 'neutral'}>{modeLabel(status.generation)}</Pill>
              </dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-meta text-ink-soft">{SETTINGS.embeddingRow}</dt>
              <dd>
                <Pill tone={status.embedding === 'live' ? 'green' : 'neutral'}>{modeLabel(status.embedding)}</Pill>
              </dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-meta text-ink-soft">{SETTINGS.resourceOriginRow}</dt>
              <dd>
                <Pill tone={status.resource_origin === 'configured' ? 'green' : 'neutral'}>
                  {stateLabel(status.resource_origin)}
                </Pill>
              </dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="text-meta text-ink-soft">{SETTINGS.timezoneRow}</dt>
              <dd>
                <Meta>{status.timezone}</Meta>
              </dd>
            </div>
          </dl>
        </Card>
      </section>
    </div>
  );
}

