'use client';

import { useEffect, useRef, useState } from 'react';
import { SAVE_PLATFORMS, type SaveSelection } from '@/domain/post-versions';
import { platformLength, PLATFORM_LIMIT } from '@/domain/format';
import { postJson } from '@/lib/client/api';
import { PlatformLogo } from '../panel/platform-logo';
import { InlineResult } from '../inline-result';
import { buttonClass } from '../button-styles';

export function SaveAs({ libraryId, text, value, onChange, canEdit }: { libraryId: string; text: string; value: SaveSelection; onChange: (v: SaveSelection) => void; canEdit: boolean }) {
  const wantChinese = value.includeChinese ?? Boolean(value.chinese);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const currentText = useRef(text);
  const currentValue = useRef(value);
  useEffect(() => { currentText.current = text; currentValue.current = value; }, [text, value]);
  const sequence = useRef(0);
  const stale = Boolean(value.chinese && value.chinese.source !== text);
  async function generate() {
    const source = text;
    const request = ++sequence.current;
    setBusy(true); setError('');
    const res = await postJson<{ ok: boolean; content?: string; message?: string }>(`/api/library/${encodeURIComponent(libraryId)}/chinese`, { source });
    if (request !== sequence.current) return;
    setBusy(false);
    if (source !== currentText.current) { setError('English changed. Generate Chinese again.'); return; }
    if (!res.body.ok || !res.body.content) { setError(res.body.message ?? 'Chinese could not be generated. Try again.'); return; }
    onChange({ ...currentValue.current, chinese: { source, content: res.body.content } });
  }
  return <fieldset className="rounded-lg border border-line p-3" disabled={!canEdit}>
    <legend className="px-1 text-xs font-semibold">Save as</legend>
    <div className="flex flex-wrap gap-x-5 gap-y-1">
      {SAVE_PLATFORMS.map(platform => <label key={platform} className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" aria-label={platform} checked={value.platforms.includes(platform)} onChange={e => onChange({ ...value, platforms: e.target.checked ? [...value.platforms, platform] : value.platforms.filter(p => p !== platform) })} />
        <PlatformLogo platform={platform} /><span>{platform}</span>
        <span className={`text-xs tabular-nums ${platformLength(text) > PLATFORM_LIMIT[platform]! ? 'text-block' : 'text-ink-soft'}`}>{platformLength(text)}/{PLATFORM_LIMIT[platform]}</span>
      </label>)}
    </div>
    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={wantChinese} onChange={e => { sequence.current++; setBusy(false); onChange({ ...value, includeChinese: e.target.checked, chinese: e.target.checked ? value.chinese : undefined }); }} />Chinese from English</label>
    {wantChinese ? <div className="flex flex-col gap-2">
      <button type="button" className={buttonClass()} disabled={busy || !text.trim()} onClick={() => void generate()}>{busy ? 'Generating…' : value.chinese ? 'Regenerate Chinese' : 'Generate Chinese'}</button>
      {value.chinese ? <label className="text-xs font-medium">Chinese review draft<textarea lang="zh-Hant-TW" rows={6} value={value.chinese.content} onChange={e => onChange({ ...value, chinese: { source: value.chinese!.source, content: e.target.value } })} className="copy mt-2 w-full resize-y rounded border border-line p-3 text-base leading-relaxed" /></label> : <p className="text-xs text-ink-soft">Generate and review Chinese before saving it.</p>}
      {stale ? <InlineResult tone="warning">English changed. Regenerate Chinese before saving.</InlineResult> : null}
    </div> : null}
    {value.platforms.length === 0 ? <p className="text-xs text-block">Select a platform to save.</p> : null}
    {error ? <InlineResult tone="error">{error}</InlineResult> : null}
  </fieldset>;
}
