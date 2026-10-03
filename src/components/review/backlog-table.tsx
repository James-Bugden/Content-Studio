import { BACKLOG_COLUMNS, COLUMN_LABEL, PILL_GLYPH, type BacklogColumn, type Pill } from '@/domain/backlog';
import { platformName, readableTitle } from '@/domain/display';
import type { ReviewCard } from '@/domain/views';
import { OpenPanelLink } from '../panel/open-panel-link';
import { PostThumb } from '../panel/post-thumb';
import { StepButton } from '../panel/step-button';

/**
 * Posts backlog (UX redesign, Calm Signal): one row per post with a marker for
 * every step, like the owner's Sheet tabs. A dense table on wide screens and
 * stacked rows on phones. The title and the next step both open the side panel
 * (`?post=`); detail stays in the panel, not the row.
 *
 * Linear-style (CS-045): every check keeps its own column, but only a problem
 * carries colour (a red dot and red words, no pill border). A finished check
 * fades to a grey label behind a green tick and a pending one sits behind a grey
 * dot, so the eye lands on the one cell that needs action. Glyphs keep each state
 * readable without colour.
 */
const PILL_TEXT_TONE: Record<Pill['tone'], string> = {
  done: 'text-ink-soft',
  todo: 'text-ink-soft',
  problem: 'text-block font-medium',
  none: 'text-ink-soft',
};
const PILL_MARK: Record<Pill['tone'], React.ReactNode> = {
  done: <span aria-hidden="true" className="font-semibold text-green">{PILL_GLYPH.done}</span>,
  todo: <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-ink-soft/50" />,
  problem: <span aria-hidden="true" className="inline-block size-2 rounded-full bg-block" />,
  none: <span aria-hidden="true">{PILL_GLYPH.none}</span>,
};

export function StepPill({ pill, column }: { pill: Pill; column?: BacklogColumn }) {
  return (
    <span data-tone={pill.tone} className={`inline-flex max-w-full items-center gap-1.5 text-xs whitespace-nowrap ${PILL_TEXT_TONE[pill.tone]}`}>
      {column ? <span className="font-normal text-ink-soft">{COLUMN_LABEL[column]}</span> : null}
      {PILL_MARK[pill.tone]}
      <span className="truncate">{pill.label}</span>
    </span>
  );
}

function titleOf(card: ReviewCard): string {
  return readableTitle(card.slug) || 'Untitled post';
}

export function BacklogTable({ cards }: { cards: ReviewCard[] }) {
  return (
    <>
      {/* Wide screens: dense table, scrollable inside its own focusable region if it ever outgrows the page. */}
      <div role="region" aria-label="Posts table" tabIndex={0} className="hidden overflow-x-auto rounded-lg border border-line bg-card md:block">
        <table className="w-full min-w-[60rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-soft">
              <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                Post
              </th>
              <th scope="col" className="px-2 py-2 font-medium whitespace-nowrap">
                Platform
              </th>
              {BACKLOG_COLUMNS.map((c) => (
                <th key={c} scope="col" className="px-2 py-2 font-medium whitespace-nowrap">
                  {COLUMN_LABEL[c]}
                </th>
              ))}
              <th scope="col" className="px-3 py-2 font-medium">
                Next step
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {cards.map((card) => (
              <tr key={card.libraryId} data-library-id={card.libraryId} className="align-middle hover:bg-paper">
                <td className="max-w-80 px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <PostThumb thumb={card.thumb} size="sm" showLabel={false} imageOnly />
                    <div className="min-w-0">
                      <OpenPanelLink target={{ post: card.libraryId }} className="inline-flex min-h-9 items-center font-medium hover:underline hover:underline-offset-4">
                        {titleOf(card)}
                      </OpenPanelLink>
                      {card.hook ? <p className="copy truncate text-xs text-ink-soft">{card.hook}</p> : null}
                    </div>
                  </div>
                </td>
                <td className="px-2 py-2 text-xs font-medium whitespace-nowrap">{platformName(card.targetPlatform)}</td>
                {BACKLOG_COLUMNS.map((c) => (
                  <td key={c} className="max-w-40 px-2 py-2">
                    <StepPill pill={card.pills[c]} />
                  </td>
                ))}
                <td className="px-3 py-2">
                  <StepButton step={card.step} target={{ post: card.libraryId }} size="sm" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phones: stacked rows with a compact wrap of labelled pills. */}
      <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-card md:hidden">
        {cards.map((card) => (
          <li key={card.libraryId} data-library-id={card.libraryId} className="flex flex-col gap-2 p-3">
            <div className="flex items-start gap-3">
              <PostThumb thumb={card.thumb} size="sm" showLabel={false} imageOnly />
              <div className="min-w-0 flex-1">
                <OpenPanelLink target={{ post: card.libraryId }} className="inline-flex min-h-11 items-center font-semibold underline decoration-line underline-offset-4">
                  {titleOf(card)}
                </OpenPanelLink>
                <p className="text-xs text-ink-soft">{platformName(card.targetPlatform)}</p>
              </div>
            </div>
            <ul aria-label="Steps" className="flex flex-wrap gap-1.5">
              {BACKLOG_COLUMNS.map((c) => (
                <li key={c} className="max-w-full">
                  <StepPill pill={card.pills[c]} column={c} />
                </li>
              ))}
            </ul>
            <div>
              <StepButton step={card.step} target={{ post: card.libraryId }} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
