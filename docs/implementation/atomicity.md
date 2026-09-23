# Provider atomicity limits

Content Studio writes to three providers that share no transaction. This page records what each provider can and cannot guarantee, and how the app compensates. It is evidence for DRV-03, REV-02 and TYPE-02, and it is honest about the gaps.

## Google Sheets

- No conditional write exists in the Sheets API (`values.batchUpdate` has no precondition).
- The repository re-reads the target row immediately before writing and compares its full-row revision (every cell, including pass-through columns and formulas) with the revision the caller loaded. A mismatch is `STALE_READ`, and nothing is written.
- **Residual window:** an edit that lands between that re-read and the write (one API round trip) can be overwritten for the named cells only. Other cells in the row are never touched. After every write the repository reads the row back and returns the new revision.
- Formula cells are never written. Values are sent with `valueInputOption=RAW`, so text beginning with `=` is stored as text, not evaluated.
- Idempotency: an operation id seen by this server instance with the same patch replays; with a different patch it conflicts. Across instances, a retry whose patch is already present in the row is reported as `skipped_already_applied` rather than written again.

## Google Drive

- Drive v3 media updates have no precondition either. The gateway re-reads file metadata (`version`) immediately before uploading and refuses on mismatch.
- Only the Library-ID section body is replaced, on the freshly read file text, so edits to other sections made before the save are kept.
- **Residual window:** an edit to another section landing between the metadata check and the upload can be lost. `tests/unit/google/drive-saga.test.ts` pins this behaviour so it cannot silently widen. Drive keeps version history, so the lost edit is recoverable from Drive's own revision list; the reconciliation centre (CS-017) links to the file for that purpose.
- After the upload the saga re-reads the file and verifies that the section holds exactly the proposed text; otherwise the step is reported as a conflict.

## Draft save saga (Drive, then Sheet)

| Drive step | Sheet step | Reported result | Retry behaviour |
| --- | --- | --- | --- |
| done | done | success | replays as already applied |
| done | failed | `PARTIAL_FAILURE` | Drive skipped as already applied, Sheet retried |
| failed | not attempted (Sheet unchanged) | the Drive error code | whole save retried |
| failed | Sheet already held the text | `PARTIAL_FAILURE` | Drive retried |
| section changed elsewhere | not attempted | `STALE_READ` with current text | editor shows base, current and proposed |

## Typefully

Recorded in CS-015 when the gateway is built.
