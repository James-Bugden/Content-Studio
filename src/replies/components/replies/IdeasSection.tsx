'use client';

import { useState } from 'react';
import { Button, Card, Meta, Pill, ReplyText, SectionHeading, StatusLine } from './primitives';
import { IDEAS } from '@/replies/lib/workspace/copy';
import { needsEnglishMeaning, type Platform } from '@/replies/lib/contracts/vocabulary';
import type { ReplyIdea, QualifiedResource } from '@/replies/lib/contracts/api';
import type { IdeasState } from '@/replies/lib/workspace/reducer';

/**
 * The three alternatives (D07).
 *
 * All three are equally readable. The "Suggested" marker is a small pill, not a
 * visual hierarchy, because the owner is choosing between three things and a
 * highlighted one quietly makes that choice for them.
 *
 * On failure there are no empty placeholder cards. A card-shaped hole implies the
 * text is coming; a sentence and a retry button say what actually happened. The
 * same argument applies before anything is asked for, which is why `idle` says so
 * rather than leaving the heading alone over nothing.
 */

function IdeaCard({
  idea,
  isSuggested,
  platform,
  resourceTitle,
  onUse,
}: {
  idea: ReplyIdea;
  isSuggested: boolean;
  platform: Platform;
  resourceTitle: string | null;
  onUse(idea: ReplyIdea): void;
}) {
  const [showMeaning, setShowMeaning] = useState(false);
  const chinese = needsEnglishMeaning(platform);

  return (
    <Card as="li" className="mb-2">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Pill>{idea.angle_label}</Pill>
        {isSuggested ? <Meta>{IDEAS.suggested}</Meta> : null}
        {/* Shown only when the idea genuinely carries a resource (D07). */}
        {idea.resource_id && resourceTitle ? <Meta>{IDEAS.includes(resourceTitle)}</Meta> : null}
      </div>

      <ReplyText text={idea.reply_text} chinese={chinese} />

      {chinese && idea.english_meaning ? (
        <div className="mt-2">
          <Button variant="quiet" onClick={() => setShowMeaning((value) => !value)} aria-expanded={showMeaning}>
            {IDEAS.showMeaning}
          </Button>
          {showMeaning ? <Meta className="mt-1">{idea.english_meaning}</Meta> : null}
        </div>
      ) : null}

      <div className="mt-2">
        <Button variant="secondary" onClick={() => onUse(idea)}>
          {IDEAS.use}
        </Button>
      </div>
    </Card>
  );
}

export interface IdeasSectionProps {
  state: IdeasState;
  platform: Platform;
  resources: QualifiedResource[];
  onUse(idea: ReplyIdea): void;
  onRetry(): void;
}

export function IdeasSection({ state, platform, resources, onUse, onRetry }: IdeasSectionProps) {
  const titleFor = (id: string | null) => resources.find((r) => r.id === id)?.title ?? null;

  return (
    <section aria-labelledby="ideas-heading" className="mb-4">
      <SectionHeading id="ideas-heading">{IDEAS.heading}</SectionHeading>

      {/* `idle` is a real state and went unrendered, so the section was a bare
          heading until the owner pressed the button. */}
      {state.status === 'idle' ? <StatusLine>{IDEAS.idle}</StatusLine> : null}

      {state.status === 'loading' ? <StatusLine>{IDEAS.loading}</StatusLine> : null}

      {state.status === 'failed' ? (
        <div>
          <StatusLine tone="error">
            {state.code === 'rate_limited'
              ? IDEAS.rateLimited
              : state.code === 'not_configured'
                ? IDEAS.notConfigured
                : state.code === 'withheld'
                  ? IDEAS.withheld
                  : IDEAS.failed}
          </StatusLine>
          {state.code !== 'not_configured' ? (
            <Button className="mt-2" onClick={onRetry}>
              {IDEAS.retry}
            </Button>
          ) : null}
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <>
          <ul className="list-none p-0">
            {state.ideas.map((idea, index) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                isSuggested={index === state.suggestedIndex}
                platform={platform}
                resourceTitle={titleFor(idea.resource_id)}
                onUse={onUse}
              />
            ))}
          </ul>
          {/* Warnings are plain sentences with real evidence behind them, never a
              fabricated similarity score. */}
          {state.warnings.map((warning) => (
            <Meta key={warning} className="mt-1">
              {warning}
            </Meta>
          ))}
        </>
      ) : null}
    </section>
  );
}

