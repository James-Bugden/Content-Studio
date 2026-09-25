'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button, Meta, cx } from './primitives';
import { SOURCE } from '@/replies/lib/workspace/copy';
import { PLATFORM_LABELS, type Platform, type TargetKind } from '@/replies/lib/contracts/vocabulary';

/**
 * The source block (D03).
 *
 * Three behaviours that are easy to get wrong and are therefore explicit:
 *
 *   * a URL is never fetched. If the owner pastes only a link, the app asks for the
 *     text, because guessing what a page says is worse than asking;
 *   * a recognised host *suggests* a platform and never forces one. The owner may
 *     be replying to a LinkedIn screenshot on Threads;
 *   * Cmd or Ctrl with Enter submits, but not during IME composition. Committing a
 *     Chinese candidate with Enter must not fire the request.
 */

const KNOWN_HOSTS: { pattern: RegExp; platform: Platform }[] = [
  { pattern: /(^|\.)linkedin\.com$/i, platform: 'linkedin' },
  { pattern: /(^|\.)(x|twitter)\.com$/i, platform: 'x' },
  { pattern: /(^|\.)threads\.(net|com)$/i, platform: 'threads' },
];

export function platformForUrl(url: string): Platform | null {
  try {
    const host = new URL(url).hostname;
    return KNOWN_HOSTS.find((entry) => entry.pattern.test(host))?.platform ?? null;
  } catch {
    return null;
  }
}

export interface SourceInputProps {
  platform: Platform;
  targetKind: TargetKind;
  sourceText: string;
  parentText: string;
  sourceUrl: string;
  busy: boolean;
  collapsed: boolean;
  onPlatformChange(platform: Platform): void;
  onTargetKindChange(kind: TargetKind): void;
  onFieldChange(field: 'sourceText' | 'parentText' | 'sourceUrl', value: string): void;
  onSubmit(): void;
  onExpandToggle(): void;
}

export function SourceInput(props: SourceInputProps) {
  const textareaId = useId();
  const urlId = useId();
  const parentId = useId();
  const [showParent, setShowParent] = useState(props.parentText !== '');
  const [error, setError] = useState<string | null>(null);
  const composing = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isKeyword = props.targetKind === 'keyword';

  function submit() {
    if (props.sourceText.trim() === '') {
      setError(SOURCE.empty);
      textareaRef.current?.focus();
      return;
    }
    setError(null);
    props.onSubmit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // `isComposing` covers browsers that report it on the event; the ref covers
    // the rest. Both are needed: an IME commit must never submit.
    if (composing.current || event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  }

  function onUrlChange(value: string) {
    props.onFieldChange('sourceUrl', value);
    const suggested = platformForUrl(value);
    if (suggested && suggested !== props.platform) props.onPlatformChange(suggested);
  }

  return (
    <section aria-labelledby="source-heading" className="mb-4">
      <h2 id="source-heading" className="mb-2 text-[0.9375rem] font-semibold">
        {SOURCE.heading}
      </h2>

      <fieldset className="mb-3">
        <legend className="sr-only">Platform</legend>
        <div role="radiogroup" aria-label="Platform" className="flex flex-wrap gap-2">
          {(Object.keys(PLATFORM_LABELS) as Platform[]).map((platform) => {
            const selected = props.platform === platform;
            return (
              <button
                key={platform}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => props.onPlatformChange(platform)}
                className={cx(
                  'min-h-8 rounded-full border px-3 text-meta',
                  selected
                    ? 'border-green bg-green-soft font-medium text-green'
                    : 'border-border-input bg-card text-ink-soft hover:bg-paper-alt',
                )}
              >
                {PLATFORM_LABELS[platform]}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="mb-2 flex flex-wrap gap-2">
        {(['post', 'comment', 'keyword'] as TargetKind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={props.targetKind === kind}
            onClick={() => props.onTargetKindChange(kind)}
            className={cx(
              'min-h-8 rounded-md border px-3 text-meta',
              props.targetKind === kind
                ? 'border-green bg-green-soft text-green'
                : 'border-border-input bg-card text-ink-soft hover:bg-paper-alt',
            )}
          >
            {kind === 'post' ? SOURCE.targetPost : kind === 'comment' ? SOURCE.targetComment : SOURCE.keywordMode}
          </button>
        ))}
      </div>

      <label htmlFor={textareaId} className="mb-1 block text-meta font-medium">
        {isKeyword ? SOURCE.keywordMode : SOURCE.label}
      </label>
      <textarea
        id={textareaId}
        ref={textareaRef}
        value={props.sourceText}
        onChange={(event) => props.onFieldChange('sourceText', event.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={onKeyDown}
        rows={props.collapsed ? 2 : 6}
        aria-invalid={error !== null}
        aria-describedby={error ? `${textareaId}-error` : undefined}
        className="w-full resize-y rounded-md border border-border-input bg-card p-3 text-reply leading-relaxed"
      />
      {props.collapsed ? (
        <Button variant="quiet" onClick={props.onExpandToggle} className="mt-1">
          {SOURCE.expand}
        </Button>
      ) : null}

      {error ? (
        <p id={`${textareaId}-error`} role="alert" className="mt-1 text-meta text-danger">
          {error}
        </p>
      ) : null}

      {isKeyword ? <Meta className="mt-2">{SOURCE.keywordOnly}</Meta> : null}

      {!isKeyword ? (
        <div className="mt-3 space-y-2">
          <div>
            <label htmlFor={urlId} className="mb-1 block text-meta font-medium">
              {SOURCE.urlLabel}
            </label>
            <input
              id={urlId}
              type="url"
              inputMode="url"
              value={props.sourceUrl}
              onChange={(event) => onUrlChange(event.target.value)}
              className="w-full rounded-md border border-border-input bg-card px-3 py-2 text-meta"
            />
          </div>

          {showParent ? (
            <div>
              <label htmlFor={parentId} className="mb-1 block text-meta font-medium">
                {SOURCE.parentLabel}
              </label>
              <Meta className="mb-1">{SOURCE.parentHint}</Meta>
              <textarea
                id={parentId}
                value={props.parentText}
                onChange={(event) => props.onFieldChange('parentText', event.target.value)}
                rows={3}
                className="w-full resize-y rounded-md border border-border-input bg-card p-3 text-meta"
              />
            </div>
          ) : (
            <Button variant="quiet" onClick={() => setShowParent(true)}>
              {SOURCE.parentLabel}
            </Button>
          )}
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-3">
        <Button variant="primary" size="primary" onClick={submit} disabled={props.busy}>
          {isKeyword ? SOURCE.keywordSubmit : SOURCE.submit}
        </Button>
        {!isKeyword ? <Meta>{SOURCE.submitHint}</Meta> : null}
      </div>
    </section>
  );
}

