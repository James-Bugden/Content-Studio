'use client';

import { useState } from 'react';
import { TransferImage } from '../image-transfer';
import { PlatformLogo } from './platform-logo';
import type { Thumb } from '@/domain/next-steps';

function PreviewIcon({ kind }: { kind: 'like' | 'reply' | 'repost' | 'share' }) {
  const paths = { like: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
    reply: 'M21 11.5a8.4 8.4 0 0 1-.9 3.8A8.5 8.5 0 0 1 12.5 20a8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z',
    repost: 'm17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3', share: 'M12 16V3m-5 5 5-5 5 5M4 14v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6' };
  return <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind]} /></svg>;
}

/** Exact copy and original image in each platform's reading layout. */
export function PlatformPreview({ platform, text, thumb, language = 'en-GB' }: { platform: string; text: string; thumb: Thumb | null; language?: string }) {
  const [expanded, setExpanded] = useState(false);
  const linkedIn = platform === 'LinkedIn';
  const threads = platform === 'Threads';
  const long = text.length > (linkedIn ? 210 : 600);
  return <article aria-label={`Preview on ${platform}`} data-platform={platform} className={`platform-preview rounded-xl border border-line bg-white p-4 text-[#191919] ${linkedIn ? 'font-[Arial,sans-serif]' : 'font-sans'}`}>
    <header className="flex items-start gap-2.5">
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-paper text-sm font-bold">J</span>
      <div className="min-w-0 flex-1 leading-snug">
        <p className="text-sm font-semibold">{threads ? 'you' : 'You'}{!linkedIn && !threads ? <span className="ml-1 font-normal text-ink-soft">@you · now</span> : null}</p>
        {linkedIn ? <><p className="text-xs text-ink-soft">Your profile headline</p><p className="text-xs text-ink-soft">Now · <span aria-label="Public">◎</span></p></> : threads ? <p className="text-xs text-ink-soft">now</p> : null}
      </div>
      <span aria-hidden="true" className="text-ink-soft">···</span><PlatformLogo platform={platform} />
    </header>
    <div className={!linkedIn ? 'pl-[50px]' : ''}>
      <p lang={language} className={`copy mt-3 whitespace-pre-wrap break-words text-[14px] leading-[1.55] ${long && !expanded ? linkedIn ? 'line-clamp-3' : 'line-clamp-10' : ''}`}>{text || 'No copy yet.'}</p>
      {long ? <button type="button" className="min-h-11 text-xs text-ink-soft hover:underline" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? 'Show less' : linkedIn ? '…see more' : 'Show more'}</button> : null}
      {thumb?.src ? <TransferImage filename={thumb.filename} contentId={thumb.contentId ?? thumb.src.split('/')[3]} src={thumb.src} alt={thumb.label} className="mt-3 w-full rounded-lg border border-line" /> : null}
      <div aria-hidden="true" className={`mt-4 flex items-center text-ink-soft ${linkedIn ? 'justify-between border-t border-line pt-3 text-xs' : 'gap-5'}`}>
        {(['like', 'reply', 'repost', 'share'] as const).map((kind, i) => <span key={kind} className="flex items-center gap-1.5"><PreviewIcon kind={kind} />{linkedIn ? ['Like', 'Comment', 'Repost', 'Send'][i] : null}</span>)}
      </div>
    </div>
  </article>;
}
