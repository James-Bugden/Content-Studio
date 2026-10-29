'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TransferImage } from '@/components/image-transfer';
import { Button, Card, Meta, Pill, SectionHeading, StatusLine } from './primitives';
import { CreateImagePanel } from '@/replies/components/images/CreateImagePanel';
import { IMAGE_SUGGESTIONS, SOURCES } from '@/replies/lib/workspace/copy';
import type { BankImage, SuggestedImage } from '@/replies/lib/contracts/api';
import type { Platform } from '@/replies/lib/contracts/vocabulary';

/**
 * Images (#245): ones already used on earlier posts or kept in the bank, matched
 * to this post, plus "Create new".
 *
 * Replies are text, so there is nothing to insert. Each image offers Copy image and
 * Download (the same transfer controls the Library uses) and the owner attaches it
 * on the platform by hand. Thumbnails load from same-origin, owner-checked URLs.
 */

export interface ImageSuggestionsSectionProps {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  images: SuggestedImage[];
  /** The image search failed: say so instead of "No matching images yet". */
  searchFailed?: boolean;
  platform: Platform;
  /** Prefill for Create new, drawn from the pasted post. */
  sourceText: string;
  onCreated(image: BankImage): void;
}

export function ImageSuggestionsSection({ status, images, searchFailed = false, platform, sourceText, onCreated }: ImageSuggestionsSectionProps) {
  const [creating, setCreating] = useState(false);

  return (
    <section aria-labelledby="image-suggestions-heading" className="mb-4">
      <SectionHeading id="image-suggestions-heading">{IMAGE_SUGGESTIONS.heading}</SectionHeading>

      {status === 'loading' ? <StatusLine>{SOURCES.loading}</StatusLine> : null}
      {status === 'ready' && searchFailed ? <StatusLine tone="error">{SOURCES.searchFailed.images}</StatusLine> : null}
      {status === 'ready' && images.length === 0 && !searchFailed ? <StatusLine>{IMAGE_SUGGESTIONS.none}</StatusLine> : null}
      {status === 'ready' && images.length > 0 ? <Meta className="mb-2">{IMAGE_SUGGESTIONS.hint}</Meta> : null}

      {images.length > 0 ? (
        <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 min-[520px]:grid-cols-2 xl:grid-cols-3">
          {images.map((image) => (
            <Card as="li" key={`${image.source}:${image.id}`}>
              <div className="mb-1 flex flex-wrap gap-1">
                <Pill>{image.source === 'post' ? IMAGE_SUGGESTIONS.fromPost : IMAGE_SUGGESTIONS.fromBank}</Pill>
              </div>
              <p className="mb-2 line-clamp-2 text-meta font-medium [overflow-wrap:anywhere]">{image.title}</p>
              <TransferImage
                src={image.url}
                alt={image.alt_text}
                filename={image.title}
                contentId={image.id}
                loading="lazy"
                className="max-h-48 w-full rounded-md object-contain"
              />
            </Card>
          ))}
        </ul>
      ) : null}

      {creating ? (
        <div className="mt-3">
          <CreateImagePanel
            platform={platform}
            defaultTitle=""
            defaultBrief={sourceText.slice(0, 600)}
            onClose={() => setCreating(false)}
            onCreated={onCreated}
          />
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button onClick={() => setCreating(true)}>{IMAGE_SUGGESTIONS.createNew}</Button>
          <Link href="/replies/images" className="text-meta text-ink-soft underline">
            {IMAGE_SUGGESTIONS.manage}
          </Link>
        </div>
      )}
    </section>
  );
}
