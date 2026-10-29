'use client';
import { useId, useState } from 'react';
import { MAX_SKETCH_CHARS, layoutLabel, type ImageOption } from '@/domain/image-options';
import { buttonClass } from '../button-styles';

/**
 * Ranked ASCII sketch options for one post (#248). Each card shows the layout,
 * why it fits and the sketch in a scrollable monospace box. "Make image" chooses
 * that sketch (approving it) and renders the real image in one step; "Edit
 * sketch" lets the owner adjust the text first.
 */
export function SketchOptionCard({ option, index, chosen, busy, canEdit, onMake }: {
  option: ImageOption; index: number; chosen: boolean; busy: boolean; canEdit: boolean;
  onMake: (option: ImageOption, sketch: string | undefined) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(option.sketch);
  const field = useId();
  const edited = editing && text !== option.sketch;
  const tooLong = text.length > MAX_SKETCH_CHARS;
  return <li data-option-id={option.id} data-chosen={chosen || undefined} className={`min-w-0 space-y-2 rounded-lg border p-3 ${chosen ? 'border-ink bg-primary-soft' : 'border-line bg-card'}`}>
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="text-xs font-semibold tabular-nums text-ink-soft">{index + 1}</span>
      <h4 className="min-w-0 break-words font-semibold">{option.title}</h4>
      <span className="rounded-sm border border-line px-1.5 text-xs">{layoutLabel(option.layout)}</span>
      {chosen ? <span className="rounded-sm bg-ink px-1.5 text-xs font-semibold text-white">Chosen</span> : null}
    </div>
    <p className="text-sm text-ink-soft">{option.reason}</p>
    {editing
      ? <div>
        <label htmlFor={field} className="text-sm">Sketch text</label>
        <textarea id={field} value={text} onChange={e => setText(e.target.value)} rows={Math.min(14, Math.max(6, text.split('\n').length + 1))} spellCheck={false} wrap="off" disabled={busy}
          className="mt-1 w-full max-w-full overflow-x-auto rounded border border-line bg-paper p-3 font-mono text-xs" />
        {tooLong ? <p className="text-sm text-block">Shorten the sketch to {MAX_SKETCH_CHARS} characters or fewer.</p> : null}
      </div>
      : <pre aria-label={`Sketch: ${option.title}`} tabIndex={0} className="max-h-64 max-w-full overflow-auto rounded bg-paper p-3 font-mono text-xs">{option.sketch}</pre>}
    {canEdit ? <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={buttonClass('primary')} aria-label={`Make image from ${option.title}`} disabled={busy || !text.trim() || tooLong} onClick={() => onMake(option, edited ? text : undefined)}>Make image</button>
      <button type="button" className={buttonClass()} aria-pressed={editing} disabled={busy} onClick={() => { if (editing) setText(option.sketch); setEditing(v => !v); }}>{editing ? 'Reset sketch' : 'Edit sketch'}</button>
    </div> : null}
  </li>;
}
