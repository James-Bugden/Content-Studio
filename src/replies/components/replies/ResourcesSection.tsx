'use client';

import { useState } from 'react';
import { Button, Card, Meta, Pill, SectionHeading, StatusLine } from './primitives';
import { RESOURCES } from '@/replies/lib/workspace/copy';
import type { QualifiedResource } from '@/replies/lib/contracts/api';
import type { ResourceSection } from '@/replies/lib/workspace/reducer';

/**
 * Resources (D06, RES-03, RES-04).
 *
 * This section stays visible in the reading order at every width. It is the one
 * thing the narrow two-window layout was chosen to protect: hiding it behind a tab
 * means the owner never shares anything, which was the point of the feature.
 *
 * Four outcomes are kept apart, because collapsing them is how a timeout becomes a
 * confident "nothing to share here": ready, nothing qualified, empty catalogue, and
 * the lookup failed.
 */

function ResourceCard({
  resource,
  added,
  onAdd,
  onCopyLink,
}: {
  resource: QualifiedResource;
  added: boolean;
  onAdd(resource: QualifiedResource): void;
  onCopyLink(resource: QualifiedResource): void;
}) {
  const hasLink = resource.url !== null;

  return (
    <Card as="li" className="mb-2">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Pill>{resource.type}</Pill>
        {resource.english_fallback ? <Pill>{RESOURCES.englishOnly}</Pill> : null}
        {/* Access wording appears only when the registry actually verified it. */}
        {resource.access_notes ? <Meta>{resource.access_notes}</Meta> : null}
      </div>

      <p className="text-[0.9375rem] font-medium">{resource.title}</p>
      <Meta className="mt-1">{resource.why_it_fits}</Meta>

      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant={added ? 'quiet' : 'secondary'} onClick={() => onAdd(resource)} disabled={added}>
          {added ? RESOURCES.alreadyAdded : hasLink ? RESOURCES.add : RESOURCES.addRecommendation}
        </Button>
        {/* A book with no approved URL has nothing to copy, so the control is absent
            rather than present and broken. */}
        {hasLink ? (
          <Button variant="quiet" onClick={() => onCopyLink(resource)}>
            {RESOURCES.copyLink}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

export interface ResourcesSectionProps {
  section: ResourceSection;
  addedResourceId: string | null;
  onAdd(resource: QualifiedResource): void;
  onCopyLink(resource: QualifiedResource): void;
  onRetry(): void;
  onOpenResources(): void;
}

export function ResourcesSection(props: ResourcesSectionProps) {
  const [showAll, setShowAll] = useState(false);
  const { section } = props;

  // The strongest match stays fully visible; the rest are one click away (D01).
  const visible = showAll ? section.items : section.items.slice(0, 1);
  const hidden = section.items.length - visible.length;

  return (
    <section aria-labelledby="resources-heading" className="mb-4">
      <SectionHeading id="resources-heading">{RESOURCES.heading}</SectionHeading>

      {section.state === 'loading' ? <StatusLine>{RESOURCES.loading}</StatusLine> : null}

      {section.state === 'error' ? (
        <div>
          <StatusLine tone="error">{RESOURCES.error}</StatusLine>
          <Button className="mt-2" onClick={props.onRetry}>
            {RESOURCES.retry}
          </Button>
        </div>
      ) : null}

      {section.state === 'empty' && section.reason === 'empty_catalog' ? (
        <div>
          <StatusLine>{RESOURCES.emptyCatalog}</StatusLine>
          <Button className="mt-2" onClick={props.onOpenResources}>
            {RESOURCES.emptyCatalogAction}
          </Button>
        </div>
      ) : null}

      {section.state === 'empty' && section.reason !== 'empty_catalog' ? (
        <StatusLine>{RESOURCES.noMatch}</StatusLine>
      ) : null}

      {section.state === 'ready' ? (
        <>
          <ul className="list-none p-0">
            {visible.map((resource) => (
              <ResourceCard
                key={resource.id}
                resource={resource}
                added={props.addedResourceId === resource.id}
                onAdd={props.onAdd}
                onCopyLink={props.onCopyLink}
              />
            ))}
          </ul>
          {hidden > 0 ? (
            <Button variant="quiet" onClick={() => setShowAll(true)}>
              {RESOURCES.showMore(hidden)}
            </Button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

