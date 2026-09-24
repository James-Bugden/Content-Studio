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
 * Colour is reserved for what genuinely needs action now: only `problem` renders
 * as a bordered, tinted badge, so it is the one thing that visually pops. Every
 * other tone (`done`, `todo`, `none`) is plain text, no border or background, no
 * pill shape, so the routine and pending states stay quiet.
 */
const PILL_TEXT_TONE: Record<Pill['tone'], string> = {
  done: 'text-green',
  todo: 'text-ink-soft',
  problem: 'text-block font-semibold',
  none: 'text-ink-soft',
};

export function StepPill({ pill, column }: { pill: Pill; column?: BacklogColumn }) {
  const badge = pill.tone === 'problem';
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 text-xs whitespace-nowrap ${PILL_TEXT_TONE[pill.tone]} ${
        badge ? 'rounded-full border border-block bg-block-soft px-2 py-0.5' : ''
      }`}
    >
      {column ? <span className="font-normal text-ink-soft">{COLUMN_LABEL[column]}</span> : null}
      <span aria-hidden="true">{PILL_GLYPH[pill.tone]}</span>
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
              <th scope="col" className="w-14 px-3 py-2 font-medium">
                <span className="sr-only">Picture</span>
              </th>
              <th scope="col" className="px-2 py-2 font-medium whitespace-nowrap">
                Post
              </th>
              <th scope="col" className="px-2 py-2 font-medium whitespace-nowrap">
                Platform
              </th>
              {BACKLOG_COLUMNS.map((c) => (
                <th key={c} scope="col" className="px-2 py-2 font-medium">
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
                <td className="px-3 py-2">
                  <PostThumb thumb={card.thumb} size="sm" showLabel={false} />
                </td>
                <td className="max-w-72 px-2 py-2">
                  <OpenPanelLink target={{ post: card.libraryId }} className="inline-flex min-h-11 items-center font-semibold underline decoration-line underline-offset-4 hover:decoration-ink">
                    {titleOf(card)}
                  </OpenPanelLink>
                  {card.hook ? <p className="copy truncate text-xs text-ink-soft">{card.hook}</p> : null}
                </td>
                <td className="px-2 py-2 text-xs font-medium whitespace-nowrap">{platformName(card.targetPlatform)}</td>
                {BACKLOG_COLUMNS.map((c) => (
                  <td key={c} className="max-w-40 px-2 py-2">
                    <StepPill pill={card.pills[c]} />
                  </td>
                ))}
                <td className="px-3 py-2">
                  <StepButton step={card.step} target={{ post: card.libraryId }} />
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
              <div className="shrink-0">
                <PostThumb thumb={card.thumb} size="sm" showLabel={false} />
              </div>
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
