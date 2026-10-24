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
- Other confirm problems now precede the existing catalogue message rather than
  suppressing it. STALE_READ retains `Reload this page to see the new preview.`;
  the no-message fallback remains `Not scheduled. Nothing was written.`
- Equals-only export mismatch retains `Change authoritative value: use the normal
  audited DB patch to choose text without a leading equals sign, then retry
  export. See the cutover runbook.` It removes `Review the direction in the
  cutover runbook; no automatic overwrite.` only when no other mismatch requires
  that advice. Mixed hand-edit/equals conflicts retain both existing sentences.

No filter, chip, empty-state, or live-region text changed. Each filter group has
exactly one black selected chip, including its own All choice at rest. A single
stable polite region reinserts its keyed content when the query changes, even
when two result counts are identical. The visible Posts empty/no-match cards
defer their implicit status announcement to this region; the global Notifications
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
