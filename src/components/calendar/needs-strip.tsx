import type { SlotSummary } from '@/domain/board';
import { formatDayShort } from '@/domain/calendar';
import { StepButton } from '../panel/step-button';

/**
 * "Needs you this week" (UX redesign): the week's slot steps due now or soon, one
 * line each, urgent first with a bordered "Urgent" badge. Open slots to
 * fill are folded into one line so the real problems stay on top.
 */
function when(s: SlotSummary): string {
  const { weekday, date } = formatDayShort(s.isoDate);
  return `${weekday} ${date} · ${s.time}`;
}

function title(s: SlotSummary): string {
  return s.empty ? 'Open slot' : s.hook || 'Untitled post';
}

export function NeedsStrip({ heading, emptyText, items }: { heading: string; emptyText: string; items: SlotSummary[] }) {
  const tasks = items.filter((s) => s.step.kind !== 'fill_slot');
  const fills = items.filter((s) => s.step.kind === 'fill_slot');
  return (
    <section aria-labelledby="needs-you" className="mb-6 rounded-lg border border-line bg-card p-4" data-testid="needs-strip">
      <h2 id="needs-you" className="text-lg font-semibold">
        {heading}
      </h2>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-ink-soft">
          <span aria-hidden="true">✓</span> {emptyText}
        </p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-line">
          {tasks.map((s) => {
            const urgent = s.step.urgency === 'now';
            return (
              <li key={s.contentId} data-task-content-id={s.contentId} data-urgency={s.step.urgency} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                {urgent ? (
                  <span className="inline-flex items-center gap-1 rounded border border-block bg-block-soft px-1.5 text-xs font-bold text-block">
                    Urgent
                  </span>
                ) : null}
                <span className="shrink-0 tabular-nums text-ink-soft">{when(s)}</span>
                <span className="shrink-0 font-semibold">{s.platform}</span>
                <span className="copy min-w-0 flex-[1_1_12rem] truncate">{title(s)}</span>
                <StepButton step={s.step} target={{ slot: s.contentId }} />
              </li>
            );
          })}
          {fills.length ? (
            <li className="py-2 text-sm" data-testid="needs-fill">
              <details>
                <summary className="flex min-h-11 cursor-pointer items-center gap-2">
                  <span aria-hidden="true">○</span>
                  {fills.length === 1 ? '1 open slot to fill' : `${fills.length} open slots to fill`}
                </summary>
                <ul className="mt-1 flex flex-col gap-1 pl-5">
                  {fills.map((s) => (
                    <li key={s.contentId} data-task-content-id={s.contentId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="tabular-nums text-ink-soft">{when(s)}</span>
                      <span className="font-semibold">{s.platform}</span>
                      <StepButton step={s.step} target={{ slot: s.contentId }} />
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
