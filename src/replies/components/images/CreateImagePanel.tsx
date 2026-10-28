'use client';

import { useId, useRef, useState } from 'react';
import { TransferImage } from '@/components/image-transfer';
import { Button, Card, Meta, SectionHeading, StatusLine } from '@/replies/components/replies/primitives';
import { adminApi } from '@/replies/components/admin/adminApi';
import { ApiError } from '@/replies/lib/workspace/client';
import { IMAGE_SUGGESTIONS } from '@/replies/lib/workspace/copy';
import type { BankImage } from '@/replies/lib/contracts/api';
import type { Platform } from '@/replies/lib/contracts/vocabulary';

/**
 * "Create new" (#245): the ASCII sketch, approve, editorial image pipeline for a
 * bank image. Each step is one request with its own key, held until that step
 * succeeds, so pressing a button twice or retrying after a lost response reuses the
 * first model call instead of paying for another.
 *
 * Nothing is saved to the bank as a finished image until the owner has seen the
 * sketch, approved that exact sketch, and asked for the image.
 */

type Phase = 'brief' | 'sketching' | 'review' | 'busy' | 'done';

export interface CreateImagePanelProps {
  platform: Platform;
  defaultTitle?: string;
  defaultBrief?: string;
  onClose(): void;
  /** Called with the finished image so a list can refresh. */
  onCreated?(image: BankImage): void;
}

function message(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.envelope.code === 'monthly_ai_limit_reached') return IMAGE_SUGGESTIONS.limit;
    if (error.envelope.code === 'validation_failed' || error.envelope.code === 'version_conflict') {
      return error.envelope.message;
    }
  }
  return IMAGE_SUGGESTIONS.failed;
}

export function CreateImagePanel({ platform, defaultTitle = '', defaultBrief = '', onClose, onCreated }: CreateImagePanelProps) {
  const [phase, setPhase] = useState<Phase>('brief');
  const [title, setTitle] = useState(defaultTitle);
  const [brief, setBrief] = useState(defaultBrief);
  const [note, setNote] = useState('');
  const [image, setImage] = useState<BankImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const briefId = useId();
  const noteId = useId();
  /** One key per step attempt; cleared only when that step succeeds. */
  const keys = useRef<Record<string, string>>({});

  const keyFor = (step: string) => (keys.current[step] ??= crypto.randomUUID());
  const settle = (step: string) => {
    delete keys.current[step];
  };

  async function run(step: 'sketch' | 'revise' | 'approve' | 'create', busyPhase: Phase, nextPhase: Phase) {
    setError(null);
    setPhase(busyPhase);
    try {
      let result: { image: BankImage };
      if (step === 'sketch') {
        result = await adminApi.createImage({
          action: 'sketch',
          request_key: keyFor(step),
          title: title.trim(),
          brief: brief.trim(),
          platform,
        });
      } else if (!image) {
        return;
      } else if (step === 'revise') {
        result = await adminApi.createImage({
          action: 'revise',
          id: image.id,
          expected_version: image.version,
          request_key: keyFor(`${step}:${note}`),
          note: note.trim(),
          platform,
        });
      } else if (step === 'approve') {
        result = await adminApi.createImage({
          action: 'approve',
          id: image.id,
          expected_version: image.version,
          request_key: keyFor(`${step}:${image.version}`),
        });
      } else {
        result = await adminApi.createImage({
          action: 'create',
          id: image.id,
          expected_version: image.version,
          request_key: keyFor(`${step}:${image.version}`),
          platform,
        });
      }
      settle(step === 'revise' ? `${step}:${note}` : step === 'sketch' ? step : `${step}:${image?.version}`);
      setImage(result.image);
      if (step === 'revise') setNote('');
      setPhase(nextPhase);
      if (step === 'create') onCreated?.(result.image);
    } catch (caught) {
      setError(message(caught));
      setPhase(step === 'sketch' ? 'brief' : 'review');
    }
  }

  const canSketch = title.trim() !== '' && brief.trim() !== '';

  return (
    <Card className="mb-3">
      <SectionHeading>{IMAGE_SUGGESTIONS.creating}</SectionHeading>

      {phase === 'brief' || phase === 'sketching' ? (
        <div className="space-y-3">
          <div>
            <label htmlFor={titleId} className="mb-1 block text-meta font-medium">
              {IMAGE_SUGGESTIONS.titleLabel}
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
            <label htmlFor={briefId} className="mb-1 block text-meta font-medium">
              {IMAGE_SUGGESTIONS.briefLabel}
            </label>
            <textarea
              id={briefId}
              value={brief}
              rows={4}
              maxLength={4000}
              onChange={(event) => setBrief(event.target.value)}
              className="w-full resize-y rounded-md border border-border-input bg-card p-3 text-meta"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="primary"
              disabled={!canSketch || phase === 'sketching'}
              onClick={() => void run('sketch', 'sketching', 'review')}
            >
              {phase === 'sketching' ? IMAGE_SUGGESTIONS.sketching : IMAGE_SUGGESTIONS.sketch}
            </Button>
            <Button variant="quiet" onClick={onClose}>
              {IMAGE_SUGGESTIONS.cancel}
            </Button>
          </div>
        </div>
      ) : null}

      {image && (phase === 'review' || phase === 'busy') ? (
        <div className="space-y-3">
          <pre
            aria-label="Sketch"
            className="max-w-full overflow-x-auto rounded-md border border-hairline bg-paper p-3 text-meta"
          >
            {image.sketch}
          </pre>

          {image.sketch_approved ? (
            <Button
              variant="primary"
              size="primary"
              disabled={phase === 'busy'}
              onClick={() => void run('create', 'busy', 'done')}
            >
              {phase === 'busy' ? IMAGE_SUGGESTIONS.creatingImage : IMAGE_SUGGESTIONS.createImage}
            </Button>
          ) : (
            <Button variant="primary" size="primary" disabled={phase === 'busy'} onClick={() => void run('approve', 'busy', 'review')}>
              {IMAGE_SUGGESTIONS.approve}
            </Button>
          )}

          <div>
            <label htmlFor={noteId} className="mb-1 block text-meta font-medium">
              {IMAGE_SUGGESTIONS.revisionNote}
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id={noteId}
                type="text"
                value={note}
                maxLength={1000}
                onChange={(event) => setNote(event.target.value)}
                className="min-w-0 flex-1 rounded-md border border-border-input bg-card px-3 py-2 text-meta"
              />
              <Button disabled={note.trim() === '' || phase === 'busy'} onClick={() => void run('revise', 'busy', 'review')}>
                {IMAGE_SUGGESTIONS.revise}
              </Button>
            </div>
          </div>
          <Button variant="quiet" onClick={onClose}>
            {IMAGE_SUGGESTIONS.cancel}
          </Button>
        </div>
      ) : null}

      {image && phase === 'done' && image.url ? (
        <div>
          <StatusLine>{IMAGE_SUGGESTIONS.done}</StatusLine>
          <div className="mt-2 max-w-[320px]">
            <TransferImage src={image.url} alt={image.alt_text} filename={image.title} contentId={image.id} className="w-full rounded-md" />
          </div>
          <Button className="mt-2" variant="quiet" onClick={onClose}>
            {IMAGE_SUGGESTIONS.cancel}
          </Button>
        </div>
      ) : null}

      {error ? <StatusLine tone="error">{error}</StatusLine> : null}
      <Meta className="mt-2">{IMAGE_SUGGESTIONS.hint}</Meta>
    </Card>
  );
}
