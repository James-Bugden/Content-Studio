import Link from 'next/link';
import type { Board, Task } from '@/domain/board';
import { longDate, platformName, shortWhen, splitTasks, taskTitle } from '@/domain/display';
import type { Thumb } from '@/domain/next-steps';
import { PageHeader } from '../page-header';
import { PostThumb } from '../panel/post-thumb';
import { StepButton } from '../panel/step-button';

/**
 * Next up (UX redesign; Linear-style in CS-045), presentation only. Answers "what
 * do I do next" from one board read: a quiet summary line, the urgent list, then
 * the next list. Every row has one button that opens the side panel on the right
 * post or slot; only the very first task gets the filled primary button.
 */
export type NextUpViewProps = Pick<Board, 'today' | 'counts' | 'tasks' | 'posts'>;

export function NextUpView({ today, counts, tasks, posts }: NextUpViewProps) {
  const { now, next, more } = splitTasks(tasks, 12);
  const thumbs = new Map(posts.map((p) => [p.libraryId, p.thumb]));
  const tiles = [
    { label: 'To review', count: counts.review, href: '/review?lane=review' },
    { label: 'Images to finish', count: counts.images, href: '/review?lane=image' },
    { label: 'Ready to schedule', count: counts.ready, href: '/schedule' },
    { label: 'Open slots this week', count: counts.openSlotsThisWeek, href: '/schedule' },
  ];

  return (
    <>
      <PageHeader
        title="Next up"
        description={
          <>
            <p>Here is what needs you</p>
            <p className="text-sm">
              <time dateTime={today}>{longDate(today)}</time>
            </p>
          </>
        }
      />

      <section aria-labelledby="summary-h">
        <h2 id="summary-h" className="sr-only">
          Summary
        </h2>
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-soft">
          {tiles.map((t) => (
            <li key={t.label}>
              <Link href={t.href} data-tile={t.label} className="inline-flex min-h-11 items-center gap-1.5 rounded-md hover:text-ink">
                <span className={`text-base font-semibold tabular-nums ${t.count > 0 ? 'text-ink' : 'text-green'}`}>
                  {t.count > 0 ? t.count : <><span aria-hidden="true">✓ </span>0</>}
                </span>
                <span>{t.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {now.length === 0 && next.length === 0 ? (
        <section aria-labelledby="clear-h" className="mt-8 rounded-lg border border-line bg-card p-6 text-center">
          <p aria-hidden="true" className="text-2xl text-green">
            ✓
          </p>
          <h2 id="clear-h" className="mt-1 text-lg font-semibold">
            You&apos;re all caught up.
          </h2>
          <p className="mt-1 text-sm text-ink-soft">Nothing needs you right now.</p>
        </section>
      ) : (
        <>
          {now.length > 0 ? (
            <section aria-labelledby="now-h" className="mt-8">
              <h2 id="now-h" className="text-lg font-semibold">
                Do these now <span className="font-normal text-ink-soft tabular-nums">({now.length})</span>
              </h2>
              <TaskList tasks={now} thumbs={thumbs} firstIsPrimary />
            </section>
          ) : null}
          {next.length > 0 ? (
            <section aria-labelledby="next-h" className="mt-8">
              <h2 id="next-h" className="text-lg font-semibold">
                Next <span className="font-normal text-ink-soft tabular-nums">({next.length + more.length})</span>
              </h2>
              <TaskList tasks={next} thumbs={thumbs} firstIsPrimary={now.length === 0} />
              {more.length > 0 ? (
                <details className="mt-2">
                  <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium underline underline-offset-4">
                    Show all ({more.length} more)
                  </summary>
                  <TaskList tasks={more} thumbs={thumbs} />
                </details>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </>
  );
}

/** Dot colour by urgency: red only for "do now", amber soon, grey otherwise. Always paired with words. */
const URGENCY_DOT: Record<Task['step']['urgency'], string> = { now: 'bg-block', soon: 'bg-attention-line', later: 'bg-ink-soft/40', none: 'bg-ink-soft/40' };

function TaskList({ tasks, thumbs, firstIsPrimary = false }: { tasks: Task[]; thumbs: Map<string, Thumb>; firstIsPrimary?: boolean }) {
  return (
    <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-card">
      {tasks.map((t, i) => {
        const thumb = 'post' in t.target ? thumbs.get(t.target.post) : undefined;
        const when = t.when ? shortWhen(t.when) : '';
        return (
          <li key={t.key} data-task={t.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 hover:bg-paper sm:flex-nowrap">
            <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${URGENCY_DOT[t.step.urgency]}`} />
            {thumb ? <PostThumb thumb={thumb} size="sm" showLabel={false} imageOnly /> : null}
            <div className="min-w-0 flex-[1_1_12rem]">
              <p className="copy truncate font-medium">{taskTitle(t)}</p>
              <p className="truncate text-sm text-ink-soft">{t.step.why}</p>
            </div>
            <p className="shrink-0 text-xs text-ink-soft tabular-nums">
              {platformName(t.platform)}
              {when ? `, ${when}` : ''}
            </p>
            <div className="shrink-0">
              <StepButton step={t.step} target={t.target} size="sm" primary={firstIsPrimary && i === 0} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
