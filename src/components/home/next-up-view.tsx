import Link from 'next/link';
import type { Board, Task } from '@/domain/board';
import { longDate, platformName, shortWhen, taskTitle } from '@/domain/display';
import type { Thumb } from '@/domain/next-steps';
import { PageHeader } from '../page-header';
import { PostThumb } from '../panel/post-thumb';
import { StepButton } from '../panel/step-button';
import { ListPill, ListPlatform } from '../list-meta';
import { ListSlotCard } from '../calendar/slot-card';
import { sortByTime } from '@/domain/calendar';
import styles from './next-up.module.css';

export type NextUpViewProps = Pick<Board, 'today' | 'counts' | 'tasks' | 'posts'> & { slots?: Board['slots']; integrationStatus?: React.ReactNode; nowPage?: number; nextPage?: number };

export function NextUpView({ today, counts, tasks, posts, slots = [], integrationStatus, nowPage = 1, nextPage = 1 }: NextUpViewProps) {
  const urgent = tasks.filter(t => t.step.urgency === 'now');
  const soon = tasks.filter(t => t.step.urgency === 'soon');
  const pageOf = (page: number, total: number) => Math.min(Math.max(1, page), Math.max(1, Math.ceil(total / 12)));
  nowPage = pageOf(nowPage, urgent.length);
  nextPage = pageOf(nextPage, soon.length);
  const now = urgent.slice((nowPage - 1) * 12, nowPage * 12);
  const next = soon.slice((nextPage - 1) * 12, nextPage * 12);
  const thumbs = new Map(posts.map((p) => [p.libraryId, p.thumb]));
  const statuses = new Map(posts.map(p => [p.libraryId, p.status]));
  const upcoming = sortByTime(slots.filter(s => !s.empty && s.isoDate >= today && ['Scheduled', 'Planned', 'Typefully Draft'].includes(s.statusLabel))).slice(0, 5);
  const tiles = [
    { label: 'To review', count: counts.review, href: '/review?lane=review' },
    { label: 'Images to finish', count: counts.images, href: '/review?lane=image' },
    { label: 'Ready to schedule', count: counts.ready, href: '/schedule' },
    { label: 'Open slots this week', count: counts.openSlotsThisWeek, href: '/schedule' },
  ];
  return (
    <>
      <PageHeader title="Next up" description={<time className="text-sm" dateTime={today}>{longDate(today)}</time>} />
      {integrationStatus}
      <section aria-labelledby="summary-h">
        <h2 id="summary-h" className="sr-only">Summary</h2>
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map(t => <li key={t.label}>
            <Link href={t.href} data-tile={t.label} className="flex h-full min-h-24 flex-col-reverse justify-between gap-2 rounded-lg border border-line bg-card p-4 hover:border-ink">
              <span className={`text-2xl font-semibold tabular-nums ${t.count ? 'text-ink' : 'text-green'}`}>{t.count ? t.count : <><span aria-hidden="true">✓ </span>0</>}</span>
              <span className="text-xs font-semibold text-ink-soft sm:text-sm">{t.label}</span>
            </Link>
          </li>)}
        </ul>
      </section>
      <div className={styles.workspace}>
        <div className="min-w-0">
          {now.length === 0 && next.length === 0 ? (
            <section className="rounded-lg border border-line bg-card p-6" aria-labelledby="clear-h">
              <h2 id="clear-h" className="font-semibold">You&apos;re all caught up.</h2>
            </section>
          ) : <>
            {now.length ? <section aria-labelledby="now-h" className="mb-6">
              <h2 id="now-h" className="mb-3 text-base font-semibold">Do these now <span className="ml-1 text-sm text-ink-soft">({urgent.length})</span></h2>
              <TaskGroups tasks={now} thumbs={thumbs} statuses={statuses} primaryKey={now[0]?.key} />
              <TaskPages label="Urgent task pages" page={nowPage} total={urgent.length} parameter="nowPage" other={{ nextPage }} />
            </section> : null}
            {next.length ? <section aria-labelledby="next-h">
              <h2 id="next-h" className="mb-3 text-base font-semibold">Next <span className="ml-1 text-sm text-ink-soft">({soon.length})</span></h2>
              <TaskGroups tasks={next} thumbs={thumbs} statuses={statuses} primaryKey={now.length ? undefined : next[0]?.key} />
              <TaskPages label="Next task pages" page={nextPage} total={soon.length} parameter="nextPage" other={{ nowPage }} />
            </section> : null}
          </>}
        </div>
        <section aria-labelledby="coming-h" className="min-w-0">
          <div className="mb-3 flex min-h-11 items-center justify-between gap-2">
            <h2 id="coming-h" className="text-base font-semibold">Coming up</h2>
            <Link href="/schedule" className="inline-flex min-h-11 items-center text-xs font-semibold underline underline-offset-4">Calendar →</Link>
          </div>
          {upcoming.length ? <ul className="flex flex-col gap-2">{upcoming.map(s => <li key={s.contentId}>
            <p className="mb-1 text-xs text-ink-soft">{shortWhen({ isoDate: s.isoDate, time: s.time })}</p>
            <ListSlotCard slot={s} past={false} />
          </li>)}</ul> : <p className="rounded-lg border border-line bg-card p-4 text-sm text-ink-soft">No upcoming scheduled posts.</p>}
        </section>
      </div>
    </>
  );
}

function actionGroup(t: Task): string {
  switch (t.step.kind) {
    case 'choose_image': case 'finish_image': case 'approve_image': return 'Finish visuals';
    case 'translate': case 'review_chinese': case 'update_chinese': return 'Chinese adaptation';
    case 'schedule': case 'queue': case 'fill_slot': case 'send_to_typefully': return 'Ready & schedule';
    default: return 'Review & fix';
  }
}

function TaskGroups({ tasks, thumbs, statuses, primaryKey }: { tasks: Task[]; thumbs: Map<string, Thumb>; statuses: Map<string, Board['posts'][number]['status']>; primaryKey?: string }) {
  // Groups follow the authoritative priority of their first task.
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const name = actionGroup(task);
    groups.set(name, [...(groups.get(name) ?? []), task]);
  }
  return <div className="overflow-hidden rounded-lg border border-line bg-card">
    {[...groups].map(([name, items]) => <div key={name} data-action-group={name}>
      <h3 className="flex items-center gap-2 border-b border-line bg-paper/50 px-4 py-2.5 text-xs font-semibold">{name}<span className="rounded border border-line bg-card px-1.5 tabular-nums">{items.length}</span></h3>
      <ul className="divide-y divide-line">{items.map(t => {
        const thumb = 'post' in t.target ? thumbs.get(t.target.post) : undefined;
        const ready = t.step.kind === 'schedule' || (t.step.kind === 'send_to_typefully' && t.step.action === 'Send to Typefully');
        const blocked = 'post' in t.target && statuses.get(t.target.post) === 'blocked';
        const label = blocked ? 'Blocked' : ready ? 'Ready' : t.step.kind === 'fill_slot' ? 'Open slot' : t.step.kind === 'queue' ? 'To queue' : t.step.urgency === 'now' ? 'Needs action' : 'To review';
        return <li key={t.key} data-task={t.key} className={styles.task}>
          <div className={styles.taskBody}>
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <ListPlatform platform={t.platform} compact />
              <span className="text-xs text-ink-soft">{platformName(t.platform)}{t.when ? `, ${shortWhen(t.when)}` : ''}</span>
              <ListPill tone={blocked ? 'block' : ready ? 'green' : 'attention'}>{label}</ListPill>
            </div>
            <p className="line-clamp-2 text-sm font-semibold">{taskTitle(t)}</p>
            <p className="mt-1 line-clamp-2 text-xs text-ink-soft">{t.step.why}</p>
          </div>
          {thumb ? <PostThumb thumb={thumb} size="sm" showLabel={false} imageOnly /> : null}
          <div className={styles.taskAction}><StepButton step={t.step} target={t.target} primary={t.key === primaryKey} /></div>
        </li>;
      })}</ul>
    </div>)}
  </div>;
}

function TaskPages({ label, page, total, parameter, other }: { label: string; page: number; total: number; parameter: string; other: Record<string, number> }) {
  const pages = Math.ceil(total / 12);
  if (pages <= 1) return null;
  const href = (target: number) => `/?${new URLSearchParams(Object.entries({ ...other, [parameter]: target }).map(([k, v]) => [k, String(v)]))}`;
  return <nav aria-label={label} className="mt-2 flex items-center justify-between text-sm">
    {page > 1 ? <Link prefetch={false} href={href(page - 1)} className="inline-flex min-h-11 items-center underline">Previous page</Link> : <span />}
    <span>Page {page} of {pages}</span>
    {page < pages ? <Link prefetch={false} href={href(page + 1)} className="inline-flex min-h-11 items-center underline">Next page</Link> : <span />}
  </nav>;
}
