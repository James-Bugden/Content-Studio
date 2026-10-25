# CS-059j review follow-ups

Scope: #191; #192 items 1-4; #193 items 1, 2, 3, 5. Synthetic local checks only;
default store remains Sheet. No dependency change, live action, push or GitHub write.

## Copy inventory

Every changed/added rendered string in this follow-up is listed here. Existing
catalogue/convention text is reused rather than introducing a new message:

- Successful fallback warning: `<failed slot label>: <existing preview problem or
  message>` replaces the unqualified problem. Example: `Thu 1 Oct · 21:00: This
  slot cannot be used.` The slot label uses the existing `slotLabel` formatter.
  Provider/catalogue problem and message text is otherwise unchanged.
- Full-page fallback: `Tue 1 Dec · LinkedIn · Main: This slot cannot be used.
  Choose another slot.` prefixes the existing warning with the requested slot
  date/platform/slot using the existing date formatter and platform/slot names.
- Elapsed confirm: `This slot cannot be used. Some input was not valid. Nothing
  was changed. Choose another slot.` Previously the problem suppressed the
  catalogue safety message. The safety sentence is exactly
  `ERROR_CATALOGUE.VALIDATION_FAILED.message`; `Choose another slot.` already
  exists on the full promotion page. We use the catalogue's `Nothing was changed`
  wording here rather than inventing `Nothing was written` for that code.
- Round 1 restores problem-first rendering for every confirm error except the
  elapsed-slot `VALIDATION_FAILED` with exactly `This slot cannot be used.` as
  its single problem. Only that case appends the server's safety message and
  `Choose another slot.` The unused client catalogue fallback is removed.
  Other validation problems retain their prior rendering too. The complete
  confirm inventory and removed additions are below.
- Equals-only export mismatch retains `Change authoritative value: use the normal
  audited DB patch to choose text without a leading equals sign, then retry
  export. See the cutover runbook.` It removes `Review the direction in the
  cutover runbook; no automatic overwrite.` only when no other mismatch requires
  that advice. Mixed hand-edit/equals conflicts retain both existing sentences.

The empty Library's sole polite announcement now reuses the existing visible
heading, exactly `The Content Library is empty`, instead of `None of the 0
Library rows match these filters.` No new product sentence is introduced. Other
filter, chip, empty-state and live-region strings are unchanged. Each filter
group has exactly one black selected chip, including its own All choice at rest.
A single stable polite region reinserts its keyed content when the committed URL
query changes, even when two result counts are identical. An optimistic click inserts nothing while
navigation is pending; commit inserts exactly one span with the new count. The
visible Posts empty/no-match cards defer their implicit status announcement to
this region; the global Notifications
toaster remains separate from filter results.

## Flake watch

Watch `sweep-fault-375` for recurrence of the #189 failure. On recurrence retain
the first failure's trace/log/screenshot, identify route, fault, document title,
render state and mutable-provider isolation, then diagnose before another run.
Do not mark a rerun green as resolution. Shared axe readiness polls for a nonempty
title with an explicit assertion message; no axe rules/exclusions were relaxed.

## Deferred evidence

#192 item 5's complete T2/187.7 judgement remains a review responsibility; local
synthetic captures can support it. #193 item 4 history measurement/capping is out
of this build scope. Real Drive DRV-01, live SQL, cross-instance leases/cron,
outbox backup, editor-copy T2 and Phase D remain owner/live gates in the runbook.

## Round 1 complete confirmation copy inventory

`Error: ` and `Check: ` are the unchanged InlineResult labels. Problems remain
joined with one space. For route responses with problems, the final body is:

| Code/case | Exact body (after the unchanged label) |
| --- | --- |
| VALIDATION_FAILED, elapsed slot | `This slot cannot be used. Some input was not valid. Nothing was changed. Choose another slot.` |
| STALE_READ, Library revision | `The Library item changed after the preview. Review the new preview. Reload this page to see the new preview.` |
| STALE_READ, Schedule revision | `The slot row changed after the preview. Review the new preview. Reload this page to see the new preview.` |
| CONFLICT, already scheduled | `Already scheduled as <content IDs joined by comma-space>.` |
| CONFLICT, duplicate slot | `The slot row is missing or its Content ID is duplicated.` |
| NOT_FOUND, missing slot | `The slot row is missing or its Content ID is duplicated.` |
| NOT_FOUND, missing Library | `Only Content Library items can be promoted.` |

All other codes with problems render exactly `<problems joined by space>`;
STALE_READ alone appends ` Reload this page to see the new preview.` Non-elapsed
VALIDATION_FAILED adds neither safety nor slot advice. Its unchanged problem
vocabulary from `planPromotion` is complete here:

- `The Library row has an unrecognised target platform.`
- `Threads rows are filled from the approved X post through the zh-TW adaptation, not promoted directly.`
- `The Schedule row has no standard Content ID.`
- `This slot is for <slot platform>, not <target platform>.`
- `The slot is not available: <availability reason>`
- `Workflow Settings has no time for <platform> <slot>.`
- `<platform> <slot> is TBD in Workflow Settings and cannot be scheduled automatically.`
- `The row time <row time> differs from Workflow Settings (<settings time>). Fix one of them first.`
- `The Library row has no Markdown link for lineage.`

With no problems, every code retains the server message. The unchanged route
catalogue messages (tested for each code) are:

| Code | Exact message |
| --- | --- |
| AUTH_REQUIRED | `Sign in to continue. Nothing was changed.` |
| FORBIDDEN | `This account cannot do that. Nothing was changed.` |
| CONFIG_MISSING | `This integration is not configured yet. Reading and manual work still function where available.` |
| SCHEMA_DRIFT | `The Sheet columns no longer match the expected layout. No write was attempted.` |
| NOT_FOUND | `That item was not found. It may have moved or been removed.` |
| STALE_READ | `This item changed since you opened it. Your version is kept; compare before saving.` |
| CONFLICT | `Someone or something else changed this first. Both versions are kept; choose what to keep.` |
| GATE_BLOCKED | `A release gate is not met yet. Resolve the listed blocker first.` |
| AMBIGUOUS_MATCH | `More than one candidate matches. Choose the right one to continue.` |
| RATE_LIMITED | `The provider asked us to slow down. Nothing was lost; try again shortly.` |
| PROVIDER_UNAVAILABLE | `A provider is unavailable. Nothing was confirmed as written; manual work is still available.` |
| PARTIAL_FAILURE | `Some steps finished and some did not. Completed steps are listed; retry the rest safely.` |
| VALIDATION_FAILED | `Some input was not valid. Nothing was changed.` |
| UNKNOWN | `Something unexpected went wrong. Nothing was confirmed as written.` |

STALE_READ without problems still appends ` Reload this page to see the new
preview.` If both problems and message are absent/empty, the existing fallback
is exactly `Not scheduled. Nothing was written.`

Round 1 removes these previously appended additions when a problem is present:
`This item changed since you opened it. Your version is kept; compare before
saving.` (STALE_READ); `Someone or something else changed this first. Both
versions are kept; choose what to keep.` (CONFLICT); `That item was not found.
It may have moved or been removed.` (NOT_FOUND). The same problem-first rule
removes any appended catalogue message for the other codes in the table above.
For non-elapsed validation it also removes ` Choose another slot.` These
catalogue entries themselves and the promote route response are unchanged.

Fallback warnings retain `<last failed slot label>: <problem or message>`.
When A and B both fail before C succeeds, B is named, rather than attributing
B's error to A.
This is covered by a two-failure test; no warning copy change is required.
The full-page fallback and equals-only/mixed repair advice listed above remain
the complete other changed-string templates from this PR.

## Axe coverage decision

The shared helper covers the five specified specs: a11y, home, calendar, shell
and ux-polish. In ux-polish, title readiness now precedes the overflow check as
well as the axe scan. This is bounded coverage, not completion of the broader
"all axe scans" wording in #191. These 20 direct scan sites in 11 files remain
outside this fix; migrating them needs their own readiness/scan-scope checks
(tagged and include-scoped builders must retain their rules):

- `backlog-pagination.spec.ts`: lines 40, 83.
- `backlog-stale.spec.ts`: line 38.
- `content-parity.spec.ts`: line 30.
- `content-read-cutover.spec.ts`: lines 43, 69.
- `content-write-cutover.spec.ts`: line 29.
- `fonts.spec.ts`: line 33.
- `image-transfer.spec.ts`: lines 127, 191.
- `markdown-authority.spec.ts`: line 56.
- `navigation-counts.spec.ts`: line 24.
- `states.spec.ts`: lines 22, 40, 45, 54, 67, 76, 93.
- `sweep-checks.ts`: line 143; shared by route and fault sweeps, including
  `sweep-fault-375`. The diagnose-before-rerun watch above still applies.

## Explicit save-time deferral / proposed #193 item 1 note

The master's actual section-level save check is **deferred**. Save still checks
level 2 and performs no Drive read. A level-4 Draft with a level-3 body heading
can therefore save; export refuses it, retains the job and leaves the master
byte-identical. Reconcile shows a blocking item with recovery guidance. The
structural export regression is implemented; the save-time extension is not.
See the [runbook](../ops/database-draft-authority.md#save-and-repair).

Proposed addition to #193 item 1: "Structural export tests are covered by
#194. Extending save-time validation to the master's actual section level is
explicitly deferred; save still validates at level 2 to remain independent of
Drive. Export refuses unsafe structure, retains the pending job, and leaves the
master unchanged."

This note is staged here because round 1 explicitly prohibits all GitHub writes;
the issue and PR body were not edited. #193 item 4 and the owner/live gates
remain deferred as stated above.
