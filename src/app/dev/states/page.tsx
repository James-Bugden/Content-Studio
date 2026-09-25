import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';
import type { Capability } from '@/domain/capability';
import { ERROR_CODES } from '@/domain/errors';
import type { Gate } from '@/domain/gates';
import { AppShell } from '@/components/app-shell';
import { buttonClass } from '@/components/button-styles';
import { CapabilityBanner } from '@/components/capability-banner';
import { FilterBar, type FilterDef } from '@/components/filter-bar';
import { InlineResult } from '@/components/inline-result';
import { PageHeader } from '@/components/page-header';
import { PillarTag } from '@/components/pillar-tag';
import type { RecoveryStep } from '@/components/recovery-panel';
import { RecoveryPanel } from '@/components/recovery-panel';
import { SourceLink } from '@/components/source-link';
import { ErrorState, STATE_KINDS, StateView } from '@/components/state-view';
import { GateChip, NextAction, StatusBadge } from '@/components/status';
import { ConflictDemo, DirtyEditorDemo, RecoveryDemo, ToastDemo } from './demos';

/**
 * States gallery (CS-006): the Storybook equivalent for the shared patterns.
 *
 * Every component in every state, with long English, long unbreakable labels and
 * CJK so layout regressions show up at 375 to 1280 px. Synthetic data only. The
 * route exists only in fake data mode, so it can never render next to real data.
 */
export const metadata: Metadata = { title: 'States gallery | Content Studio', robots: { index: false, follow: false } };

const LONG_EN =
  'This is a deliberately long English sentence that keeps going so the layout has to wrap it across several lines without hiding the controls that sit next to it.';
const CJK = '談薪水不是吵架：先準備好你的市場行情，再用具體成果說明你值得這個數字。';
const UNBREAKABLE = 'https-docs-example-invalid-drive-folder-synthetic-0123456789abcdefghijklmnopqrstuvwxyz-0123456789abcdefghijklmnopqrstuvwxyz';

const gates: Gate[] = [
  { code: 'DUPLICATE_CHECK', severity: 'hard', field: 'Duplicate QA', message: 'A possible duplicate needs a decision.', nextAction: 'Decide whether this duplicates earlier content', human: true },
  { code: 'REVIEW_PENDING', severity: 'hard', field: 'Review Status', message: 'Waiting for review.', nextAction: 'Review and approve, or request changes', human: true },
  { code: 'APPROVAL_LEGACY', severity: 'soft', field: 'Review Status', message: 'Approved outside Content Studio, so later edits cannot be detected.', nextAction: 'Re-approve here to protect this approval', human: true },
  { code: 'VISUAL_BRIEF_INCOMPLETE', severity: 'hard', field: 'Image Brief', message: `${LONG_EN}`, nextAction: 'Complete the brief in Visual Studio', human: true },
  { code: 'ZH_ADAPTATION_NOT_REVIEWED', severity: 'hard', field: 'Threads adaptation', message: `繁體中文改寫尚未審核：${CJK}`, nextAction: '審核並核准繁體中文改寫', human: true },
];

const capabilities: Capability[] = [
  { provider: 'sheet', state: 'ready', mode: 'fake' },
  { provider: 'drive', state: 'read_only', mode: 'fake', detail: 'write scope not configured' },
  { provider: 'typefully', state: 'not_configured', mode: 'fake' },
  { provider: 'ai', state: 'degraded', mode: 'fake', detail: 'slow responses' },
  { provider: 'auth', state: 'ready', mode: 'fake' },
];

const filters: FilterDef[] = [
  {
    key: 'platform',
    label: 'Target platform',
    options: [
      { value: 'X', label: 'X' },
      { value: 'Threads', label: 'Threads' },
      { value: 'LinkedIn', label: 'LinkedIn' },
    ],
  },
  {
    key: 'status',
    label: 'Gate status',
    options: [
      { value: 'ready', label: 'Ready' },
      { value: 'needs_action', label: 'Needs action' },
      { value: 'blocked', label: 'Blocked' },
    ],
  },
  { key: 'lang', label: 'Language', options: [{ value: 'en', label: 'English' }, { value: 'zh-TW', label: '繁體中文' }] },
];

const stepsPartial: RecoveryStep[] = [
  { step: 'Update the Markdown section', status: 'done', provider: 'Drive' },
  { step: 'Update Draft Content in the Library row', status: 'skipped_already_applied', provider: 'Sheet' },
  { step: 'Update the Typefully draft', status: 'failed', provider: 'Typefully' },
  { step: 'Record final-sync time', status: 'pending', provider: 'Sheet' },
];
const stepsDone: RecoveryStep[] = [
  { step: 'Update the Markdown section', status: 'done', provider: 'Drive' },
  { step: 'Update Draft Content in the Library row', status: 'done', provider: 'Sheet' },
];

const conflictBase = 'Most people lose the raise before the meeting.\n\nThey walk in with a feeling, not a number.';
const conflictCurrent = 'Most people lose the raise before the meeting starts.\n\nThey walk in with a feeling, not a number. \u{1F4B8}\n\n談薪水不是吵架。';
const conflictProposed = 'Most people lose the raise before the meeting.\n\nThey walk in with a feeling,\nnot a number.\n\n  Indented line kept exactly.\n\n談薪水不是吵架：先準備好你的市場行情。 \u{1F91D}';

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mb-10">
      <h2 id={id} className="mb-3 border-b border-line pb-1 text-lg font-semibold">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export default async function StatesGalleryPage() {
  await connection();
  if (process.env.CS_DATA_MODE !== 'fake') notFound();

  return (
    <AppShell accountSlot={<span className="text-ink-soft">Synthetic owner</span>}>
      <PageHeader
        title="States gallery"
        description="Every shared pattern in every state, with synthetic data only. Available only in fake data mode."
        actions={
          <>
            <button type="button" className={buttonClass('primary')}>
              Primary action
            </button>
            <button type="button" className={buttonClass('secondary')}>
              Secondary
            </button>
          </>
        }
      />
      <PageHeader title={`A long page title that wraps: ${CJK}`} description={LONG_EN} actions={<button type="button" className={buttonClass('secondary')}>Action stays visible</button>} />

      <Section id="g-capability" title="Capability banner">
        <CapabilityBanner capabilities={capabilities} />
        <p className="text-sm text-ink-soft">When every provider is ready the banner renders nothing.</p>
      </Section>

      <Section id="g-status" title="Status badges and gate chips">
        <div className="flex flex-wrap gap-2">
          <StatusBadge status="ready" />
          <StatusBadge status="needs_action" />
          <StatusBadge status="blocked" />
        </div>
        <ul className="flex flex-wrap gap-2">
          {gates.map((gate) => (
            <li key={gate.code} className="max-w-full">
              <GateChip gate={gate} />
            </li>
          ))}
        </ul>
      </Section>

      <Section id="g-pillars" title="PESTO tags">
        <div className="flex flex-wrap gap-2">
          {['Personal story', 'Expertise', 'Social proof', 'Trending', 'Opinions', 'Build in public (Soar)', 'Custom value'].map((pillar) => (
            <PillarTag key={pillar} value={pillar} />
          ))}
        </div>
      </Section>

      <Section id="g-next" title="Next action">
        <NextAction gate={gates[1] ?? null} />
        <NextAction gate={gates[4] ?? null} />
        <NextAction gate={null} />
      </Section>

      <Section id="g-filters" title="Filter bar">
        <Suspense fallback={<StateView kind="loading" title="Loading filters" />}>
          <FilterBar filters={filters} />
        </Suspense>
      </Section>

      <Section id="g-states" title="Region states">
        {STATE_KINDS.map((kind) => (
          <StateView key={kind} kind={kind} />
        ))}
        <StateView kind="no_match" title={CJK} detail={LONG_EN} action={<button type="button" className={buttonClass('secondary')}>Clear filters</button>} />
      </Section>

      <Section id="g-errors" title="Typed errors">
        {ERROR_CODES.map((code) => (
          <ErrorState key={code} code={code} />
        ))}
      </Section>

      <Section id="g-links" title="Source links">
        <ul className="space-y-2">
          <li>
            <SourceLink href="https://example.invalid/doc/synthetic-1" label="Source Markdown: salary negotiation master" />
          </li>
          <li>
            <SourceLink href="https://example.invalid/doc/synthetic-2" label={UNBREAKABLE} />
          </li>
          <li>
            <SourceLink href="https://example.invalid/doc/synthetic-3" label={`原始檔案：${CJK}`} />
          </li>
          <li>
            <SourceLink href="javascript:alert(1)" label="Unsafe link from a hostile cell" />
          </li>
        </ul>
      </Section>

      <Section id="g-results" title="Inline results and toasts">
        <InlineResult tone="success">Draft saved to the Sheet and Markdown.</InlineResult>
        <InlineResult tone="info">Typefully is not configured, so this stays a draft here.</InlineResult>
        <InlineResult tone="warning">{LONG_EN}</InlineResult>
        <InlineResult tone="error">{`儲存失敗：${CJK}`}</InlineResult>
        <ToastDemo />
      </Section>

      <Section id="g-conflict" title="Conflict dialog">
        <ConflictDemo base={conflictBase} current={conflictCurrent} proposed={conflictProposed} />
        <ConflictDemo base={null} current={conflictCurrent} proposed={`${conflictProposed}\n${UNBREAKABLE}`} />
      </Section>

      <Section id="g-recovery" title="Recovery panel">
        <RecoveryDemo operationId="op-synthetic-0001" steps={stepsPartial} />
        <RecoveryPanel operationId="op-synthetic-0002" steps={stepsDone} />
      </Section>

      <Section id="g-dirty" title="Unsaved changes guard">
        <DirtyEditorDemo />
      </Section>
    </AppShell>
  );
}
