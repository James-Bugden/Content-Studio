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

API facts and unverified points: [typefully-api.md](typefully-api.md).

- **No idempotency key and no conditional update** exist in the v2 API.
- **Create (TYPE-02):** the service derives a key from the operation id and Content ID, stores it as a marker in the draft notes, and before any create (a) looks the marker up, (b) runs the candidate search and refuses on any candidate. A lost create response therefore ends as a link on retry, not a second draft. Concurrent calls with the same operation in one instance share one promise.
- **Residual window (create):** two server instances running the same operation at the same moment could both miss each other's marker and both create. A new operation after a lost response is caught by the candidate search (same slot and text), not by the marker. A draft created without a planned time has no `scheduled_date`, so only its marker finds it.
- **Create then Sheet write:** if the Sheet write fails after Typefully succeeded, the result is `PARTIAL_FAILURE` carrying the draft id, and a retry of the same operation links that draft.
- **Update (TYPE-05):** the adapter re-reads the draft and compares `updated_at` immediately before `PATCH`. An edit landing in that one round trip can be overwritten on the Typefully side; Typefully's own version history is the recovery path. The service refuses a push outright when Typefully changed since the last sync.
- **Sync baseline:** `Final Synced From Typefully` holds the sync time and a short hash of the exact text synced (`<ISO +08:00> #<hash>`). A later sync compares both sides with that hash, so a Sheet edit to `Final Content` and a Typefully edit are each detected without trusting clocks. A legacy stamp with no hash has no baseline and differing text is a conflict.
- **Publication and analytics (PUB-03/04):** these writes touch only the Schedule sync fields, never `Content`, `Chinese Content` or (for analytics) `Final Content`. A Sheet `Published At`, `Post Link` or `Published` status that disagrees with Typefully is a conflict, never corrected by inference.

| Typefully step | Sheet step | Reported result | Retry behaviour |
| --- | --- | --- | --- |
| create done | link done | success | replays as already applied |
| create done, response lost | not attempted | `PROVIDER_UNAVAILABLE` (`create_outcome_unknown`) | same operation finds the marker and links |
| create done | link failed | `PARTIAL_FAILURE` with draft id | same operation finds the marker and links |
| candidate found | not attempted | `AMBIGUOUS_MATCH` or `CONFLICT` (`existing_match`) | human links or chooses |
| update done | write failed | `PARTIAL_FAILURE` | push retried: Typefully already holds the text, only the Sheet is written |
