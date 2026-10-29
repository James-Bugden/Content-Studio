'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MarkdownImportPreview } from '@/domain/markdown-import';
import { buttonClass } from '../button-styles';
import { useActionsGate } from './actions-gate';

export function MarkdownImport() {
  const router = useRouter();
  const [link, setLink] = useState('');
  const [preview, setPreview] = useState<MarkdownImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const keys = useRef(new Map<string, string>());
  // CS #250: applying writes the database; wait until every streamed check finished successfully.
  const gate = useActionsGate();
  async function send(input: unknown) {
    const response = await fetch('/api/markdown-import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.code === 'STALE_READ' ? 'The preview is out of date. Preview the master again.' : 'Import could not complete. Your saved database draft is kept.');
    return result;
  }
  async function load() {
    setBusy(true); setMessage(''); setPreview(null);
    try { const result = await send({ action: 'preview', link }); keys.current.clear(); setPreview(result.preview); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Import failed.'); }
    finally { setBusy(false); }
  }
  async function apply(section: MarkdownImportPreview['sections'][number], direction: 'markdown_to_db' | 'keep_db') {
    if (!preview || !gate.enabled) return;
    setBusy(true); setMessage('');
    const key = `${section.libraryId}:${direction}`;
    if (!keys.current.has(key)) keys.current.set(key, crypto.randomUUID());
    try {
      await send({ action: 'apply', section: { operationId: keys.current.get(key), libraryId: section.libraryId, fileId: preview.fileId, fileRevision: preview.fileRevision,
        expectedRevision: section.expectedRevision, sectionHash: section.sectionHash, markdownBody: section.markdownBody, direction } });
      setMessage(direction === 'keep_db' ? 'Database body kept. Drive was not changed.' : !section.differs ? 'The database already holds this Markdown body.' : 'Markdown section imported into the database.');
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Import failed.'); }
    finally { setBusy(false); }
  }
  return <section className="rounded-lg border border-line bg-card p-4" aria-labelledby="markdown-import-h">
    <h2 id="markdown-import-h" className="text-lg font-semibold">Import Markdown master</h2>
    <p className="text-sm">Preview sections matched by Library ID. Compare exact text, then choose a direction for each section. Unmatched sections are not imported.</p>
    <label htmlFor="markdown-master-link" className="mt-3 block text-sm font-medium">Drive master link</label>
    <input disabled={busy} id="markdown-master-link" className="mt-1 w-full rounded-md border border-line p-2" value={link} onChange={event => { setLink(event.target.value); setPreview(null); }} />
    <button type="button" className={buttonClass()} disabled={busy || !link.trim()} onClick={() => void load()}>Preview master</button>
    <p role="status" className="mt-2 text-sm">{busy ? 'Working…' : message}</p>
    {preview?.refused.length ? <p className="text-sm">Duplicate sections refused: {preview.refused.join(', ')}. Give each Library ID one section, then preview again.</p> : null}
    {preview?.sections.map(section => <article aria-label={`Import ${section.libraryId}`} key={section.libraryId} className="mt-4 min-w-0 border-t border-line pt-3">
      <h3 className="font-semibold">{section.libraryId}: {section.differs ? 'Bodies differ; choose a direction' : 'Bodies match'}</h3>
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <div className="min-w-0"><p>Database body</p><pre className="copy whitespace-pre-wrap break-words">{section.databaseBody}</pre></div>
        <div className="min-w-0"><p>Markdown body</p><pre className="copy whitespace-pre-wrap break-words">{section.markdownBody}</pre></div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2"><button type="button" className={buttonClass()} disabled={busy || !gate.enabled} onClick={() => void apply(section, 'markdown_to_db')}>Use Markdown body</button>
        <button type="button" className={buttonClass()} disabled={busy || !gate.enabled} onClick={() => void apply(section, 'keep_db')}>Keep database body</button></div>
      {gate.reason ? <p className="mt-1 text-sm text-ink-soft">{gate.reason}</p> : null}
    </article>)}
  </section>;
}
