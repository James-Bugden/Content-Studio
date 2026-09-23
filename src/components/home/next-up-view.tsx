import Link from 'next/link';
import type { Board, Task } from '@/domain/board';
import { longDate, platformName, shortWhen, splitTasks, taskTitle } from '@/domain/display';
import type { Thumb } from '@/domain/next-steps';
import { PageHeader } from '../page-header';
import { PostThumb } from '../panel/post-thumb';
import { StepButton } from '../panel/step-button';

/**
 * Next up (UX redesign), presentation only. Answers "what do I do next" from one
 * board read: four summary tiles, the urgent list, then the next list. Every row
 * has one button that opens the side panel on the right post or slot.
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
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((t) => (
            <li key={t.label} className="min-w-0">
              <Link
                href={t.href}
                data-tile={t.label}
                className="flex min-h-24 flex-col justify-between gap-2 rounded-lg border border-line bg-card p-4 hover:border-ink"
              >
                {t.count > 0 ? (
                  <span className="text-3xl font-semibold tabular-nums">{t.count}</span>
                ) : (
                  <span className="inline-flex items-center gap-2 text-3xl font-semibold text-green tabular-nums">
                    <span aria-hidden="true">✓</span>
                    <span>0</span>
                  </span>
                )}
                <span className="text-sm font-medium">{t.label}</span>
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
              <TaskList tasks={now} thumbs={thumbs} />
            </section>
          ) : null}
          {next.length > 0 ? (
            <section aria-labelledby="next-h" className="mt-8">
              <h2 id="next-h" className="text-lg font-semibold">
                Next <span className="font-normal text-ink-soft tabular-nums">({next.length + more.length})</span>
              </h2>
              <TaskList tasks={next} thumbs={thumbs} />
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

function TaskList({ tasks, thumbs }: { tasks: Task[]; thumbs: Map<string, Thumb> }) {
  return (
    <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-card">
      {tasks.map((t) => {
        const thumb = 'post' in t.target ? thumbs.get(t.target.post) : undefined;
        const when = t.when ? shortWhen(t.when) : '';
        return (
          <li key={t.key} data-task={t.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 sm:flex-nowrap">
            {thumb ? (
              <div className="shrink-0">
                <PostThumb thumb={thumb} size="sm" showLabel={false} />
              </div>
            ) : null}
            <div className="min-w-0 flex-[1_1_12rem]">
              <p className="copy truncate font-semibold">{taskTitle(t)}</p>
              <p className="text-xs text-ink-soft">
                {platformName(t.platform)}
                {when ? `, ${when}` : ''}
              </p>
              <p className="mt-0.5 text-sm text-ink-soft">{t.step.why}</p>
            </div>
            <div className="shrink-0">
              <StepButton step={t.step} target={t.target} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
