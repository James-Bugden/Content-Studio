# DB-7 draft body authority

DB-10 wires this authority for live `db` behind durable measured gates and
distributed worker locks; [cutover.md](cutover.md) supersedes the historical
fake-only wiring/refusal statements below. No production flip is claimed.

Status: local fake/PGlite preparation only; **no production cutover**.
Issue: [#151](https://github.com/James-Bugden/Content-Studio/issues/151).
The owner delegated section 3's choice to the coordinator, who selected (b):
database draft bodies, asynchronous Drive export. This is a design decision,
not evidence that any live gate has passed.

Only the `db` composition opts into body authority. `sheet`, `db-shadow` and
`db-read` retain the Drive-first saga and its existing conflict/recovery rules.
The default stays `sheet`; live `db-read` and `db` remain refused before
provider construction. Assets, reference files and workflow files stay in Drive.
DB-9 prepares live `db-shadow` separately; it retains Drive body authority.

## Save and repair

Draft save is one `apply_patch`, including approval invalidation and the private
`content_studio_markdown_export` outbox. Hook selection likewise changes the
opening and hook fields together. The SQL wrapper retains the existing ledger,
CAS, history and audit transaction; outbox failure rolls everything back.
Only changed Library bodies enqueue; Sheet imports/write-through do not. Replays and
stale/failed attempts never add another job. Multiple pending saves coalesce to
the latest body while keeping the first unexported baseline.

The fake models this transaction in one synchronous mutation turn. The additive
`20261025000400_content_markdown_export.sql` prepares the SQL equivalent and
service-role-only completion RPC. It has **not** been applied live. It adds no
columns to the version-2 row representation and does not advance that version;
separately reviewed live enablement must explicitly require this migration too.

The draft route schedules repair with Next `after`, outside the save response.
The existing authenticated 15-minute Content export repair also drains Markdown
jobs, including hook updates and retries. No cron is installed by this change.
A Drive failure never vetoes the DB save. Save rejects section-level headings
and open code fences with the existing Sheet validation/copy, using the standard
**level-2 boundary without a Drive read**. The proposed save-time check against
the master's actual section level (#193 item 1) is **deferred**, not implemented.
This does not detect level-3 headings in a level-4 Draft section; fresh export validates the actual section level and
refuses unsafe structure without changing the master or acknowledging the job.
Reading Drive during save to discover its level would break the Drive-independent
save contract; that extension is deferred until section metadata can be trusted
without a provider read.
Missing links and missing/duplicate sections appear as `markdown_missing`
when no job is pending; audited body edits make these blocking. Pending jobs,
provider failures, unsafe Markdown structure and conflicting Drive bodies appear
as `markdown_export_lag`. A known unconfirmed job remains visible
even if Drive currently shows equal text. Conflict/one-hour lag is blocking.

Repair reads the fresh file and matches its section by Library ID. It refuses
an unexpected section body, uses `safeReplaceSectionBody`, passes the fresh
Drive revision to `writeText`, then verifies the whole returned file and revision.
The comparison covers every byte around the section, Unicode, CRLF/LF, spaces
and tabs. A lost response can be retried without a duplicate content write.
Completion of an older job advances the newer job's baseline without deleting
that newer save. Duplicate completion cannot move a baseline backwards.

Drive's existing metadata-check/write residual race remains; this is not a
claim of provider-side atomic compare-and-set. Local single flight serializes
repair in this instance. Cross-instance leases and hosted race tests remain
mandatory before any live worker is wired.

## Import Markdown master

The owner-only action is on Fix issues in `db` mode. Preview is a read-only POST
with normal session/same-origin checks. It reads the supplied Drive master and
matches existing Library IDs with the established heading, marker and labelled
section parser. Duplicate sections are explicitly refused; uniquely matched
sections remain available. Unmatched sections are not imported and new Library
rows are not invented.

For each section the preview shows exact database and Markdown text. No default
direction is chosen. **Use Markdown body** confirms an audited DB patch carrying
the operation ID, DB revision, Drive file revision, section hash and exact text.
A missing direction, changed file, changed section or stale DB row refuses;
repeating the same successful request replays the DB ledger without another
history row. A newly changed master needs a new preview, even on a retry.
**Keep database body** performs no mutation: it neither changes Drive nor grants
permission for a subsequent export overwrite. A conflicting Drive body therefore
stays preserved and visible until deliberately resolved. This is not a force
export action.

Import is one-off body intake. Existing source links/export destinations are
retained; the supplied master does not become a second authority. Material body
changes invalidate approval inside the same DB patch, including English QA and
hook changes. Equal-body imports do not invalidate approval. Assets and metadata
are not imported. For multiple sections each confirmation is separately audited;
there is no misleading all-master transaction or bulk overwrite.

## Rollback and live gates

The DB composition extends DB-6 rollback: freeze/drain writes, drain Markdown jobs
and verify exact body bytes before final Sheet export parity and the `sheet` flip.
Every pending job must be acknowledged, even if Drive already shows its body.
Every resolvable section must match the database, including empty bodies.
Missing links/sections and ambiguous matches on legacy rows with no audited body
edit are not export lag and do not block rollback: the Sheet/Drive editor already
handled those rows as missing. Initial import inserts are not DB-authored bodies.

Any audited Library body change with a before-image makes exact export mandatory,
including after its outbox job is acknowledged or if the section later disappears.
History is deliberately conservative: historical body-changing copies with a
before-image also require parity. Do not erase history to bypass this check.
Pending jobs, unreadable Drive, or unequal bodies refuse rollback. A Markdown
refusal restores the previous write state after the drain; an already frozen DB
stays frozen. Later Sheet-parity or flip failures retain DB-6's read-only state.

Fix issues names the affected Library ID and links to its editor. For missing or
duplicate sections, restore the intended master/link and give that ID exactly one
section containing the saved DB body; retry repair and rollback. Preserve a copy
of ambiguous text before changing the synthetic/private master. For a Drive body
conflict, preview Import Markdown master and explicitly choose the desired body;
keeping DB text alone does not authorize overwriting Drive. For an unsafe legacy
body, remove section-level headings/close fences and save again. For a stale
queued snapshot after an out-of-band DB edit, save the chosen body through the
editor with a fresh operation, then repair (an equal-body save creates no job;
make a deliberate content correction if needed). Never delete a pending job to
force rollback. Sheet repair is attempted even when Markdown repair throws.

All [DB-6 gates](database-write-cutover.md) remain. Hosted ACL/advisor checks,
independent-backend concurrency, durable leases and export lag measurements,
the owner freeze/backup permissions/billing, copied-workbook/branch rehearsal,
deployment and T4 smoke remain unpassed. Backup archives currently contain the
six DB-6 authority/history tables, not the derived outbox: before live enablement
define and rehearse outbox backup/reconstruction without adopting an unknown
Drive baseline. The current fake outbox is process-local; the SQL outbox and
PostgREST methods exist but the live container remains deliberately unwired.
No destructive production operation or invented cutover date is authorized here.

Local verification uses synthetic fake providers and PGlite only. Coverage
includes atomic save/outbox rollback, stale revision and replay guards, exact UTF-8
and adjacent-byte preservation, provider revision/readback checks, coalesced jobs,
import direction, approval invalidation, and rollback parity. A level-4 Draft
containing `intro\n### Deeper heading\nmore` is saved under the level-2 DB
validation but export refuses it, retains its pending job, and leaves the entire
master unchanged. These checks are local evidence, not DRV-01 against real Drive
or live SQL/concurrency/cron/backup/editor T2/Phase D evidence.

An unedited legacy row with a resolvable section whose Drive body differs from
the DB also refuses rollback. Resolve that pre-existing drift before retrying:
back up both versions, preview Import Markdown master, and explicitly select
**Use Markdown body** if Drive is the intended text. If the DB text is intended,
preserve the Drive version and deliberately restore the matching DB text in its
unique section, then verify exact parity. **Keep database body** alone does not
repair drift or authorize an overwrite. Never remove history or queue records to
bypass parity.
