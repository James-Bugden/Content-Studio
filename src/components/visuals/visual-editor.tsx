'use client';

import { useMemo, useState } from 'react';
import type { Gate } from '@/domain/gates';
import { validateBrief, type BriefProblem, type VisualBrief } from '@/domain/visual';
import { canvasFor, renderBriefSvg, type RenderProblem } from '@/domain/visual-render';
import { GRAMMAR_LABEL, PLACEMENT_LABEL, type ReuseCheck, type VisualItemView } from '@/domain/visual-studio';
import { newOperationId, postJson } from '@/lib/client/api';
import { buttonClass } from '../button-styles';
import { InlineResult } from '../inline-result';
import { GateChip } from '../status';
import { useDirtyGuard } from '../use-dirty-guard';

/**
 * Visual Studio editor (CS-012). Decision, structured brief with live checks,
 * render, and exact-revision review at full size and at 360 and 390 px phone
 * widths. Every button is a convenience: the server re-reads the row and re-runs
 * every gate before writing, and refuses a stale revision.
 *
 * Previews are <img> elements pointing at the server render route (or a data URL
 * of the pure renderer for the unsaved draft), so SVG never runs as markup here.
 */

type Section = 'decision' | 'brief' | 'render' | 'approve';

type Outcome =
  | { ok: true; item: VisualItemView; replayed: boolean; note?: string; reuse?: ReuseCheck }
  | {
      ok: false;
      code: string;
      message?: string;
      blockers?: Gate[];
      problems?: (BriefProblem | RenderProblem)[];
      reuse?: ReuseCheck;
      current?: VisualItemView;
    };

type Form = {
  lesson: string;
  grammar: VisualBrief['grammar'];
  asciiPlan: string;
  ideas: [string, string, string, string];
  copy: string;
  focal: string;
  caveat: string;
  illustrative: boolean;
  placement: VisualBrief['placement'];
  altText: string;
};

function formFrom(item: VisualItemView): Form {
  const b = item.brief ?? {};
  const ideas = [...(b.mainIdeas ?? [])];
  return {
    lesson: b.lesson ?? '',
    grammar: b.grammar ?? 'list',
    asciiPlan: b.asciiPlan ?? '',
    ideas: [ideas[0] ?? '', ideas[1] ?? '', ideas[2] ?? '', ideas.slice(3).join(' ')],
    copy: b.lineBrokenCopy ?? '',
    focal: b.focalPhrase ?? '',
    caveat: b.caveat ?? '',
    illustrative: b.illustrativeReconstruction === true,
    placement: b.placement ?? 'feed-square',
    altText: b.altText ?? item.altText,
  };
}

function briefOf(f: Form): VisualBrief {
  return {
    lesson: f.lesson,
    grammar: f.grammar,
    asciiPlan: f.asciiPlan,
    mainIdeas: f.ideas.map((i) => i.trim()).filter((i) => i !== ''),
    lineBrokenCopy: f.copy,
    focalPhrase: f.focal,
    ...(f.caveat.trim() ? { caveat: f.caveat } : {}),
    ...(f.illustrative ? { illustrativeReconstruction: true } : {}),
    placement: f.placement,
    altText: f.altText,
  };
}

const FIELD_LABEL: Record<string, string> = {
  lesson: 'Lesson',
  grammar: 'Grammar',
  asciiPlan: 'ASCII plan',
  mainIdeas: 'Main ideas',
  lineBrokenCopy: 'Exact copy',
  focalPhrase: 'Focal phrase',
  caveat: 'Caveat',
  placement: 'Placement',
  altText: 'Alt text',
  brief: 'Brief',
};

const APPROVAL_TEXT: Record<VisualItemView['approval'], string> = {
  not_approved: 'Not approved',
  approved: 'Approved (this exact revision)',
  approved_legacy: 'Approved outside Content Studio (no stamp, so later changes cannot be detected)',
  stale: 'Stale: changed after approval',
};

const input = 'min-h-11 w-full rounded-md border border-line bg-card px-3 py-2 text-base';

export function VisualEditor({ initial, canEdit }: { initial: VisualItemView; canEdit: boolean }) {
  const [item, setItem] = useState(initial);
  const [baseline, setBaseline] = useState(() => formFrom(initial));
  const [form, setForm] = useState(() => formFrom(initial));
  const [choice, setChoice] = useState<'text_only' | 'original_graphic' | 'screenshot'>(
    initial.decision === 'screenshot' ? 'screenshot' : initial.decision === 'text_only' ? 'text_only' : 'original_graphic',
  );
  const [shotId, setShotId] = useState(initial.screenshotId ?? '');
  const [reuse, setReuse] = useState<ReuseCheck | null>(initial.decision === 'screenshot' ? initial.reuse : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ section: Section; tone: 'success' | 'warning' | 'error' | 'info'; text: string; details?: string[] } | null>(null);
  const [latest, setLatest] = useState<VisualItemView | null>(null);
  const [pendingOp, setPendingOp] = useState<{ key: string; id: string } | null>(null);

  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  useDirtyGuard(dirty);

  const brief = useMemo(() => briefOf(form), [form]);
  const problems = useMemo(() => validateBrief(brief), [brief]);
  const live = useMemo(() => {
    if (problems.length > 0 || !item.platform || !item.language) return null;
    return renderBriefSvg(brief, { language: item.language, platform: item.platform, revision: 0 });
  }, [brief, problems, item.platform, item.language]);
  const ideasFilled = brief.mainIdeas.length;

  function adopt(next: VisualItemView, resetForm: boolean) {
    setItem(next);
    if (resetForm) {
      const f = formFrom(next);
      setBaseline(f);
      setForm(f);
    }
  }

  async function run(section: Section, key: string, payload: Record<string, unknown>, opts: { write: boolean } = { write: true }) {
    const opId = pendingOp && pendingOp.key === key ? pendingOp.id : newOperationId('visual');
    if (opts.write) setPendingOp({ key, id: opId });
    setBusy(key);
    setResult(null);
    setLatest(null);
    const body = (
      await postJson<Outcome>(`/api/library/${encodeURIComponent(item.libraryId)}/visual`, {
        libraryId: item.libraryId,
        ...(opts.write ? { operationId: opId, expectedRevision: item.revision } : {}),
        ...payload,
      })
    ).body as Outcome;
    setBusy(null);
    if (body.ok) {
      setPendingOp(null);
      adopt(body.item, section === 'brief' || section === 'decision');
      if (body.reuse) setReuse(body.reuse);
      if (opts.write) setResult({ section, tone: 'success', text: body.note ?? 'Saved.' });
      return body;
    }
    if (body.reuse) setReuse(body.reuse);
    const details = [...(body.problems ?? []).map((p) => p.message), ...(body.blockers ?? []).map((b) => b.message)];
    if ((body.code === 'STALE_READ' || body.code === 'CONFLICT') && body.current) {
      setPendingOp(null);
      setLatest(body.current);
      setResult({ section, tone: 'warning', text: body.message ?? 'This item changed in the Sheet after you opened it. Nothing was written.' });
      return body;
    }
    if (body.code === 'GATE_BLOCKED') {
      setPendingOp(null);
      if (body.current) adopt(body.current, false);
      setResult({ section, tone: 'warning', text: `Not done: ${body.message ?? 'a gate is not met.'}`, details: [...new Set(details)] });
      return body;
    }
    setResult({ section, tone: 'error', text: body.message ?? 'That did not complete. Nothing is confirmed as written; try again.', details });
    return body;
  }

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setIdea = (i: number, value: string) =>
    setForm((f) => {
      const ideas = [...f.ideas] as Form['ideas'];
      ideas[i] = value;
      return { ...f, ideas };
    });

  const canvas = canvasFor((item.brief?.placement as VisualBrief['placement'] | undefined) ?? 'feed-square');
  const previewSrc = `/api/library/${encodeURIComponent(item.libraryId)}/render?rev=current&m=${item.material}`;
  const liveSrc = live ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(live.svg)}` : null;
  const languageText = item.language === 'zh-TW' ? 'zh-TW (Traditional Chinese, composed for Threads)' : item.language === 'en' ? 'English' : 'Unknown';
  const renderBlocked = !item.canRender.ok ? item.canRender.reason : dirty ? 'Save the brief first.' : null;

  const sectionResult = (section: Section) =>
    result && result.section === section ? (
      <div className="mt-3 flex flex-col gap-2">
        <InlineResult tone={result.tone}>
          {result.text}
          {result.details && result.details.length > 0 ? (
            <ul className="mt-1 list-disc pl-5">
              {result.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}
        </InlineResult>
        {latest ? (
          <div>
            <button
              type="button"
              className={buttonClass()}
              onClick={() => {
                adopt(latest, true);
                setLatest(null);
                setResult(null);
              }}
            >
              Load the latest version
            </button>
          </div>
        ) : null}
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Facts */}
      <section aria-labelledby="facts-h" className="rounded-lg border border-line bg-card p-4">
        <h2 id="facts-h" className="text-sm font-semibold">
          Visual status
        </h2>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Platform" value={item.platformLabel} />
          <Fact label="Language" value={languageText} />
          <Fact label="Decision" value={item.decisionLabel} />
          <Fact label="Image status" value={item.imageStatus} />
          <Fact label="Visual version" value={item.version || 'None yet'} mono />
          <Fact label="Approval" value={item.decision === 'text_only' ? 'Not needed for Text only' : APPROVAL_TEXT[item.approval]} />
        </dl>
        {item.language ? (
          <p className="mt-2 text-xs text-ink-soft">English and zh-TW visuals are composed separately. Write this copy in {item.language === 'zh-TW' ? 'zh-TW' : 'English'} for {item.platformLabel}.</p>
        ) : null}
        {item.approval === 'stale' ? (
          <div className="mt-3" data-testid="stale-banner">
            <InlineResult tone="warning">
              Approval is stale. The brief, file, alt text or version changed after {item.version || 'the approved revision'} was approved, so it no longer counts. Render a new revision and approve it.
            </InlineResult>
          </div>
        ) : null}
        {item.gates.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1.5" aria-label="Visual blockers">
            {item.gates.map((g, i) => (
              <li key={`${g.code}-${i}`}>
                <GateChip gate={g} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm">No visual blockers.</p>
        )}
      </section>

      {/* Decision */}
      <section aria-labelledby="decision-h" className="rounded-lg border border-line bg-card p-4">
        <h2 id="decision-h" className="text-base font-semibold">
          1. Decision
        </h2>
        <fieldset className="mt-3" disabled={!canEdit || busy !== null}>
          <legend className="text-sm text-ink-soft">What goes with this post?</legend>
          <div className="mt-2 flex flex-col gap-2">
            {(
              [
                ['text_only', 'Text only', 'No image. A complete decision on its own.'],
                ['original_graphic', 'Original graphic', 'A fresh SOAR v1.1 C-light graphic from a brief.'],
                ['screenshot', 'Screenshot', 'An exact screenshot id, used at most once per platform.'],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className="flex min-h-11 items-start gap-3 rounded-md border border-line px-3 py-2">
                <input type="radio" name="decision" value={value} checked={choice === value} onChange={() => setChoice(value)} className="mt-1 size-4" />
                <span>
                  <span className="font-medium">{label}</span>
                  <span className="block text-xs text-ink-soft">{hint}</span>
                </span>
              </label>
            ))}
          </div>
          {choice === 'screenshot' ? (
            <div className="mt-3 flex flex-col gap-2">
              <label htmlFor="shot-id" className="text-sm font-medium">
                Screenshot id
              </label>
              <div className="flex flex-wrap gap-2">
                <input id="shot-id" value={shotId} maxLength={120} onChange={(e) => setShotId(e.target.value)} className={`${input} max-w-xs font-mono`} placeholder="SHOT-2026-014" />
                <button type="button" className={buttonClass()} disabled={shotId.trim() === ''} onClick={() => void run('decision', 'check', { action: 'check_screenshot', screenshotId: shotId.trim() }, { write: false })}>
                  Check reuse
                </button>
              </div>
            </div>
          ) : null}
          {reuse && choice === 'screenshot' ? (
            <div className="mt-3">
              <InlineResult tone={reuse.state === 'same_platform' || reuse.state === 'uncertain' ? 'warning' : 'info'}>Reuse check: {reuse.message}</InlineResult>
            </div>
          ) : null}
          {canEdit ? (
            <div className="mt-3">
              <button
                type="button"
                className={buttonClass('primary')}
                disabled={choice === 'screenshot' && shotId.trim() === ''}
                onClick={() => void run('decision', `decide-${choice}`, { action: 'decide', decision: choice === 'screenshot' ? { screenshotId: shotId.trim() } : choice })}
              >
                {busy?.startsWith('decide') ? 'Saving…' : 'Save decision'}
              </button>
            </div>
          ) : null}
        </fieldset>
        {sectionResult('decision')}
      </section>

      {/* Brief */}
      {item.decision === 'original_graphic' ? (
        <section aria-labelledby="brief-h" className="rounded-lg border border-line bg-card p-4">
          <h2 id="brief-h" className="text-base font-semibold">
            2. Brief
          </h2>
          <p className="mt-1 text-sm text-ink-soft">Plan the structure in ASCII first, then the simplest grammar that teaches it, 2 to 4 main ideas and the exact copy with its line breaks.</p>
          {item.briefUnreadable ? (
            <div className="mt-3">
              <InlineResult tone="warning">Image Brief holds free text, not a structured brief. Saving here replaces it with a structured brief.</InlineResult>
            </div>
          ) : null}
          <form
            className="mt-4 flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run('brief', 'brief', { action: 'brief', brief });
            }}
          >
            <fieldset disabled={!canEdit || busy !== null} className="flex min-w-0 flex-col gap-4">
              <Field id="f-ascii" label="ASCII plan" hint="Sketch the layout first. Monospace, kept as typed.">
                <textarea id="f-ascii" rows={5} value={form.asciiPlan} onChange={(e) => set('asciiPlan', e.target.value)} className={`${input} font-mono text-sm whitespace-pre`} spellCheck={false} />
              </Field>
              <Field id="f-lesson" label="Lesson" hint="The one thing the reader should take away.">
                <input id="f-lesson" value={form.lesson} maxLength={300} onChange={(e) => set('lesson', e.target.value)} className={input} />
              </Field>
              <Field id="f-grammar" label="Grammar">
                <select id="f-grammar" value={form.grammar} onChange={(e) => set('grammar', e.target.value as Form['grammar'])} className={input}>
                  {Object.entries(GRAMMAR_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <fieldset className="flex min-w-0 flex-col gap-2">
                <legend className="text-sm font-medium">
                  Main ideas <span className="font-normal text-ink-soft">(2 to 4; {ideasFilled} filled)</span>
                </legend>
                {form.ideas.map((idea, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <label htmlFor={`f-idea-${i}`} className="text-xs text-ink-soft">
                      Main idea {i + 1}
                    </label>
                    <input id={`f-idea-${i}`} value={idea} maxLength={200} onChange={(e) => setIdea(i, e.target.value)} className={input} lang={item.language ?? undefined} />
                  </div>
                ))}
              </fieldset>
              <Field id="f-copy" label="Exact line-broken copy" hint="Every line break here is a line break in the image. Nothing is re-wrapped.">
                <textarea id="f-copy" rows={5} value={form.copy} onChange={(e) => set('copy', e.target.value)} className={`${input} copy`} lang={item.language ?? undefined} />
              </Field>
              <Field id="f-focal" label="Focal phrase" hint="Must appear on one copy line. It gets the one yellow highlight.">
                <input id="f-focal" value={form.focal} maxLength={120} onChange={(e) => set('focal', e.target.value)} className={input} lang={item.language ?? undefined} />
              </Field>
              <Field id="f-caveat" label="Caveat (optional)" hint="Shown small at the foot. Required, and must say illustrative, for an illustrative reconstruction.">
                <input id="f-caveat" value={form.caveat} maxLength={200} onChange={(e) => set('caveat', e.target.value)} className={input} lang={item.language ?? undefined} />
              </Field>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input type="checkbox" checked={form.illustrative} onChange={(e) => set('illustrative', e.target.checked)} className="size-4" />
                Illustrative reconstruction (not a real document or screen)
              </label>
              <Field id="f-placement" label="Placement">
                <select id="f-placement" value={form.placement} onChange={(e) => set('placement', e.target.value as Form['placement'])} className={input}>
                  {Object.entries(PLACEMENT_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="f-alt" label="Alt text" hint="Describe what the image shows, in the post's language.">
                <textarea id="f-alt" rows={2} value={form.altText} maxLength={500} onChange={(e) => set('altText', e.target.value)} className={input} lang={item.language ?? undefined} />
              </Field>
            </fieldset>

            <div aria-live="polite" className="flex flex-col gap-2">
              {problems.length > 0 ? (
                <InlineResult tone="info">
                  The brief is not complete yet:
                  <ul className="mt-1 list-disc pl-5">
                    {problems.map((p, i) => (
                      <li key={i}>
                        {FIELD_LABEL[p.field] ?? p.field}: {p.field === 'mainIdeas' ? `Use 2 to 4 main ideas (${ideasFilled} now).` : p.message.replace(/^\w+ is required\.$/, 'Required.')}
                      </li>
                    ))}
                  </ul>
                </InlineResult>
              ) : live && live.problems.length > 0 ? (
                <InlineResult tone="warning">
                  Layout problems at 1080 px:
                  <ul className="mt-1 list-disc pl-5">
                    {live.problems.map((p, i) => (
                      <li key={i}>{p.message}</li>
                    ))}
                  </ul>
                </InlineResult>
              ) : (
                <InlineResult tone="success">The brief is complete and fits the layout.</InlineResult>
              )}
            </div>

            {liveSrc ? (
              <figure className="flex flex-col gap-1">
                <figcaption className="text-xs text-ink-soft">Draft preview of the brief as typed (not a revision; nothing saved)</figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element -- private no-store preview; next/image would proxy and cache it */}
                <img src={liveSrc} alt={brief.altText || 'Draft preview'} width={240} height={Math.round((240 * canvasFor(form.placement).height) / 1080)} className="border border-line" />
              </figure>
            ) : null}

            {canEdit ? (
              <div className="flex flex-wrap items-center gap-2">
                <button type="submit" className={buttonClass(dirty ? 'primary' : 'secondary')} disabled={busy !== null || !dirty}>
                  {busy === 'brief' ? 'Saving…' : 'Save brief'}
                </button>
                {dirty ? <span className="text-sm text-ink-soft">Unsaved changes</span> : <span className="text-sm text-ink-soft">Saved</span>}
              </div>
            ) : null}
          </form>
          {sectionResult('brief')}
        </section>
      ) : null}

      {/* Render */}
      {item.decision === 'original_graphic' ? (
        <section aria-labelledby="render-h" className="rounded-lg border border-line bg-card p-4">
          <h2 id="render-h" className="text-base font-semibold">
            3. Render
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            Renders a new deterministic revision, uploads it to Drive as a new file and sets Image Status to Needs Review. Rendering never approves.
          </p>
          {item.canRender.ok ? (
            <p className="mt-2 text-sm">
              Next revision: <span className="font-mono">{item.canRender.nextVersion}</span>
            </p>
          ) : null}
          {canEdit ? (
            <div className="mt-3 flex flex-col gap-2">
              <div>
                <button type="button" className={buttonClass('primary')} disabled={busy !== null || renderBlocked !== null} aria-describedby={renderBlocked ? 'render-why' : undefined} onClick={() => void run('render', 'render', { action: 'render' })}>
                  {busy === 'render' ? 'Rendering…' : 'Render new revision'}
                </button>
              </div>
              {renderBlocked ? (
                <p id="render-why" className="text-sm text-ink-soft">
                  Not available: {renderBlocked}
                </p>
              ) : null}
            </div>
          ) : null}
          {sectionResult('render')}
        </section>
      ) : null}

      {/* Review and approve */}
      {item.decision === 'original_graphic' || item.decision === 'screenshot' ? (
        <section aria-labelledby="review-h" className="rounded-lg border border-line bg-card p-4">
          <h2 id="review-h" className="text-base font-semibold">
            {item.decision === 'original_graphic' ? '4. Review and approve' : '2. Review and approve'}
          </h2>
          {item.decision === 'original_graphic' && item.preview === 'changed' ? (
            <div className="mt-2" data-testid="preview-changed">
              <InlineResult tone="warning">
                The brief, version or file changed after {item.version} was rendered, so that revision is not shown here: a preview of the new brief under the old label would not be what you approve. Render a new revision to review it.
              </InlineResult>
            </div>
          ) : item.decision === 'original_graphic' && item.preview === 'current' ? (
            <>
              <p className="mt-2 text-sm">
                Revision under review: <span className="font-mono font-semibold" data-testid="version-label">{item.version}</span>
              </p>
              <p className="mt-1 text-xs text-ink-soft">Check it at full size and at both phone widths before approving. Approval belongs to this exact revision only.</p>
              <figure className="mt-4 flex flex-col gap-1">
                <figcaption className="text-sm font-medium">Full size ({canvas.width} x {canvas.height} px)</figcaption>
                <div tabIndex={0} role="region" aria-label="Full-size preview (scrolls)" className="max-h-[36rem] max-w-full overflow-auto rounded-md border border-line bg-paper">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private no-store preview; next/image would proxy and cache it */}
                  <img src={previewSrc} alt={item.altText} width={canvas.width} height={canvas.height} className="block max-w-none" />
                </div>
                <a href={previewSrc} target="_blank" rel="noopener noreferrer" className="text-sm underline">
                  Open full size in a new tab
                </a>
              </figure>
              <div tabIndex={0} className="mt-4 max-w-full overflow-x-auto" role="region" aria-label="Phone width previews (scrolls sideways)">
                <div className="flex w-max gap-4 pb-2">
                  {[360, 390].map((w) => (
                    <figure key={w} className="flex flex-col gap-1" data-phone-width={w}>
                      <figcaption className="text-sm font-medium">Phone width {w} px</figcaption>
                      <div className="bg-paper ring-1 ring-line" style={{ width: w }}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- private no-store preview; next/image would proxy and cache it */}
                        <img src={previewSrc} alt={`${item.altText} (at ${w} px)`} width={w} height={Math.round((w * canvas.height) / canvas.width)} className="block" />
                      </div>
                    </figure>
                  ))}
                </div>
              </div>
            </>
          ) : item.decision === 'screenshot' ? (
            <dl className="mt-2 text-sm">
              <dt className="text-ink-soft">Screenshot id</dt>
              <dd className="font-mono">{item.screenshotId}</dd>
              <dt className="mt-2 text-ink-soft">Alt text (from the Sheet)</dt>
              <dd>{item.altText || 'None yet'}</dd>
            </dl>
          ) : (
            <p className="mt-2 text-sm text-ink-soft">No revision rendered yet.</p>
          )}

          {item.approval === 'approved' ? (
            <div className="mt-4">
              <InlineResult tone="success">
                Approved {item.version || item.decisionLabel} for {item.platformLabel}.
              </InlineResult>
            </div>
          ) : null}

          {canEdit ? (
            <div className="mt-4 flex flex-col gap-2">
              <div>
                <button
                  type="button"
                  className={buttonClass('primary')}
                  disabled={busy !== null || !item.reviewable.ok}
                  aria-describedby={!item.reviewable.ok ? 'approve-why' : undefined}
                  onClick={() => void run('approve', 'approve', { action: 'approve', version: item.version, fileHash: item.fileHash, material: item.material })}
                >
                  {busy === 'approve' ? 'Approving…' : 'Approve this exact revision'}
                </button>
              </div>
              {!item.reviewable.ok ? (
                <p id="approve-why" className="text-sm text-ink-soft">
                  Not available: {item.reviewable.reason}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-xs text-ink-soft">Read-only access: approval is hidden.</p>
          )}
          {sectionResult('approve')}
        </section>
      ) : null}
    </div>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {hint ? <p className="text-xs text-ink-soft">{hint}</p> : null}
      {children}
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className={`font-medium ${mono ? 'font-mono text-sm' : ''}`}>{value}</dd>
    </div>
  );
}
