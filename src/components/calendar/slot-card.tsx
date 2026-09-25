import type { SlotSummary } from '@/domain/board';
import { slotStatus, type SlotLook } from '@/domain/calendar';
import { OpenPanelLink } from '../panel/open-panel-link';
import { PillarTag } from '../pillar-tag';
import { PostThumb } from '../panel/post-thumb';

/**
 * One schedule slot as a card (UX redesign). The whole card is one link that opens
 * the slot panel (`?slot=<Content ID>`); the Content ID itself stays out of the
 * visible text and lives in `data-content-id`. Status is a word plus a glyph.
 */
const STATUS_TEXT: Record<SlotLook, string> = {
  published: 'text-green',
  scheduled: 'text-green',
  review: 'text-attention',
  open: 'text-ink-soft',
  waiting: 'text-attention',
  missed: 'text-block',
  problem: 'text-block',
};

export function hasStep(slot: SlotSummary): boolean {
  return slot.step.kind !== 'done' && slot.step.kind !== 'wait';
}

export function StatusLine({ slot }: { slot: SlotSummary }) {
  const st = slotStatus(slot);
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${STATUS_TEXT[st.look]}`}>
      <span aria-hidden="true">{st.glyph}</span> {st.label}
    </span>
  );
}

function StepLine({ slot }: { slot: SlotSummary }) {
  if (!hasStep(slot) || slot.empty) return null;
  const urgent = slot.step.urgency === 'now';
  return (
    <span className={`mt-1 inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold ${urgent ? 'border border-block bg-block-soft text-block' : 'border border-attention-line bg-attention-soft text-attention'}`}>
      <span aria-hidden="true">→</span>{' '}
      <span className="truncate">{slot.step.action}</span>
    </span>
  );
}

function cardFrame(slot: SlotSummary, past: boolean): string {
  const urgent = slot.step.urgency === 'now' && hasStep(slot);
  if (slot.empty) return `border border-dashed border-line ${past ? 'bg-paper' : 'bg-card'}`;
  if (urgent) return 'border-2 border-block bg-card';
  return `border border-line ${past ? 'bg-paper' : 'bg-card'}`;
}

/** Compact card for a week grid cell. */
export function WeekSlotCard({ slot, past }: { slot: SlotSummary; past: boolean }) {
  const st = slotStatus(slot);
  return (
    <div data-content-id={slot.contentId} data-slot-state={st.look}>
      <OpenPanelLink target={{ slot: slot.contentId }} className={`block rounded-md p-1.5 text-left text-xs hover:border-ink ${cardFrame(slot, past)}`}>
        {slot.empty ? (
          <EmptyBody slot={slot} />
        ) : (
          <>
            <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] text-ink-soft">
              <span><span className="font-semibold text-ink">{slot.platform}</span> · <span className="tabular-nums">{slot.time}</span></span>
              {slot.expectedPillar ? <PillarTag value={slot.expectedPillar} /> : null}
            </span>
            <span className="mt-0.5 flex items-start gap-1.5">
              <span className="min-w-0 flex-1">
                <span className="copy line-clamp-2 break-words font-medium text-ink">{slot.hook || 'No hook yet'}</span>
                <span className="mt-0.5 block">
                  <StatusLine slot={slot} />
                </span>
              </span>
              <PostThumbSmall slot={slot} />
            </span>
            <StepLine slot={slot} />
          </>
        )}
      </OpenPanelLink>
    </div>
  );
}

function PostThumbSmall({ slot }: { slot: SlotSummary }) {
  return (
    <span className="block w-8 shrink-0 [&_figure>div]:size-8">
      <PostThumb thumb={slot.thumb} size="sm" showLabel={false} />
    </span>
  );
}

function EmptyBody({ slot }: { slot: SlotSummary }) {
  const st = slotStatus(slot);
  if (st.look === 'waiting') {
    return (
      <span className="block text-attention">
        <span className="tabular-nums">{slot.time}</span> · Waiting for X
      </span>
    );
  }
  if (st.look === 'missed') {
    return (
      <span className="block text-block">
        <span aria-hidden="true">×</span> Missed · <span className="tabular-nums">{slot.time}</span>
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center justify-between gap-x-1 text-ink-soft">
      <span>
        Open · <span className="tabular-nums">{slot.time}</span>
      </span>
      {slot.expectedPillar ? <PillarTag value={slot.expectedPillar} /> : null}
      {slot.step.kind === 'fill_slot' ? <span className="font-semibold text-primary underline">Fill</span> : <span>{slot.step.action}</span>}
    </span>
  );
}

/** Full-width card for the list view. */
export function ListSlotCard({ slot, past }: { slot: SlotSummary; past: boolean }) {
  const st = slotStatus(slot);
  return (
    <div data-content-id={slot.contentId} data-slot-state={st.look}>
      <OpenPanelLink
        target={{ slot: slot.contentId }}
        className={`flex min-h-11 items-start gap-3 rounded-md p-3 text-left text-sm hover:border-ink ${cardFrame(slot, past)}`}
      >
        {slot.empty ? null : <PostThumb thumb={slot.thumb} size="sm" showLabel={false} />}
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-ink-soft">
            <span className="font-semibold text-ink">{slot.platform}</span> · <span className="tabular-nums">{slot.time}</span>
          </span>
          {slot.expectedPillar ? <span className="mt-1 block"><PillarTag value={slot.expectedPillar} /></span> : null}
          {slot.empty ? (
            <span className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <StatusLine slot={slot} />
              {slot.step.kind === 'fill_slot' ? <span className="font-semibold text-primary underline">Fill</span> : null}
            </span>
          ) : (
            <>
              <span className="copy mt-0.5 line-clamp-2 break-words font-medium">{slot.hook || 'No hook yet'}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <StatusLine slot={slot} />
                <StepLine slot={slot} />
              </span>
            </>
          )}
        </span>
      </OpenPanelLink>
    </div>
  );
}
