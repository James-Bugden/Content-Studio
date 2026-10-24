# Typefully API facts (CS-015/016)

Initially researched 2026-09-23 from the public documentation: <https://typefully.com/docs/api> (API v2 reference), the Typefully Help Center article "Typefully API v1 to v2 migration guide" and the Typefully changelog. Live verification on 2026-10-24 used the Typefully connector for read-only checks plus one explicitly authorised, labelled inert draft; results are recorded in [CS-052 / issue #138](https://github.com/James-Bugden/Content-Studio/issues/138) and its [write-path evidence comment](https://github.com/James-Bugden/Content-Studio/issues/138#issuecomment-6384072684). The tables distinguish documented facts, observed live behaviour and remaining unknowns. The adapter uses defensive handling for unverified behaviour; Tier T3 verification against an authorised test surface must confirm the remaining applicable items before live writes are enabled.

## Confirmed from the documentation

| Topic | Fact | Used in |
| --- | --- | --- |
| Base URL | `https://api.typefully.com`, path prefix `/v2` (OpenAPI version 2.0.0). No version header. | `TYPEFULLY_BASE_URL` |
| Auth | `Authorization: Bearer <API key>` on every request. | `LiveTypefullyGateway.once` |
| Social sets | `GET /v2/social-sets` (limit/offset), `GET /v2/social-sets/{social_set_id}/`. Everything else is scoped to one social set. | env `TYPEFULLY_SOCIAL_SET_ID` |
| List drafts | `GET /v2/social-sets/{id}/drafts`; filters `status` (`draft`, `published`, `scheduled`, `planned`, `error`, `publishing`), `tag`; `order_by` one of `created_at`, `updated_at`, `scheduled_date`, `published_at` with optional `-` prefix. Pagination `limit` (default 10, max 50) and `offset`; response `results`, `count`, `limit`, `offset`, `next`, `previous`. **No date-range filter.** | `listDrafts`, `findByIdempotencyKey` |
| Get draft | `GET /v2/social-sets/{id}/drafts/{draft_id}`, query `exclude_comment_markers`. Response carries per-platform `platforms.<p>.posts[].text`. | `getDraft` |
| Create draft | `POST /v2/social-sets/{id}/drafts` (201). Body `platforms: { x | linkedin | threads | ...: { enabled, posts: [{ text }] } }`, optional `draft_title`, `scratchpad_text`, `tags`, `share`, and optionally **either** `publish_at` (`now`, `next-free-slot` or ISO 8601 with offset) **or** `plan_at` (dated but inert, never auto-publishes). | `createDraft` |
| Update draft | `PATCH /v2/social-sets/{id}/drafts/{draft_id}` with the same body shape; `force_overwrite_comments` (default false); comment markers must round-trip. | `updateDraft` |
| Delete draft | `DELETE .../drafts/{draft_id}` (204). Not used. | none |
| Full-draft fields (not the list-item shape) | `id` (integer), `status` (`draft`, `scheduled`, `planned`, `publishing`, `published`, `error`), `scheduled_date` and `published_at` (UTC ISO or null), `created_at`, `updated_at`, `publish_state`, `private_url`, `share_url`, `scratchpad_text`, and per platform `<p>_post_enabled`, `<p>_published_url`, `<p>_post_published_at` for `x`, `linkedin`, `threads` (and others). | `toDraft` |
| Idempotency | **None.** No idempotency key or duplicate prevention is documented. | see design below |
| Analytics | `GET /v2/social-sets/{id}/analytics/{platform}/posts` with required `start_date`, `end_date`, optional `include_replies`, `limit` (max 100), `offset`. **Only `x` is supported.** Per post: `post_id`, `platform`, `created_at`, `preview_text`, `url`, optional `draft_id`, `metrics.impressions`, `metrics.engagement.{likes, shares, comments, quotes, profile_clicks, total}`, optional `link_clicks` and `saves`. `GET .../analytics/{platform}/followers` gives daily follower counts per account, not per post. | `getPublication` |
| Rate limits | 429 on excess. Headers `X-RateLimit-User-{Limit,Remaining,Reset}` and `X-RateLimit-SocialSet-{Limit,Remaining,Reset,Resource}`; reset is a Unix timestamp. | `retryAfter` |
| Errors | `{ "error": { "code", "message", "details" } }`; statuses 400, 401, 402, 403, 404, 409, 422, 429, 503. | `mapStatus` |

## Verified against the live API (2026-10-24, read-only plus one labelled inert draft)

Read-only checks used the owner's social set. Write checks used only the explicitly authorised unscheduled test draft titled "CS API TEST - synthetic, safe to delete" (synthetic test draft ID `11449220`), left in place for the owner to delete. No publishing or deletion was performed. No private post text, real content draft IDs, account identifiers or tokens are recorded here.

| Point | Observed fact | Adapter implication |
| --- | --- | --- |
| List-item text and scratchpad | List items expose truncated text in `preview`, without `platforms.<p>.posts[].text` or `scratchpad_text`. The single-draft GET provides full posts and scratchpad. | Fetch the full draft for exact text; the existing marker fallback fetches up to 10 recent drafts to read `scratchpad_text`. A preview is not exact final copy. |
| Planned date | `planned` drafts carry their date in `scheduled_date`. | Planned drafts can participate in the time-window search. |
| Descending date order | Under `order_by=-scheduled_date`, undated drafts sort first. | Skip undated drafts for time matching and continue scanning; stop only after passing the dated window. The scan refuses (`PROVIDER_UNAVAILABLE`, `candidate_scan_truncated`) rather than silently stopping after 20 pages. |
| Multi-post representation and create | Read-only GETs return separate per-platform `posts[]` entries. Creating with two `platforms.threads.posts` entries and neither `publish_at` nor `plan_at` returns separate posts with status `draft`, nothing scheduled. | The API supports multi-post drafts. The adapter's single-post create with exact text is a deliberate implementation choice. |
| Preview separator | `preview` joins posts with one newline. | The adapter's four-newline join when reading posts as one text is its own convention, not Typefully's preview format. |
| Scratchpad on create | `scratchpad_text` round-trips on create and is present on the single-draft GET, absent from list items. | The idempotency marker field survives create; this does not establish provider-side deduplication. |
| Partial PATCH | PATCH containing only `platforms.threads.posts` updates text, preserves `draft_title` and `scratchpad_text`, and advances `updated_at`. | Partial-update semantics are confirmed for this payload on the inert draft; comment-marker behaviour remains unverified. |

## Unverified (designed around)

| Point | Design response | Evidence needed to close |
| --- | --- | --- |
| Numeric rate limits and whether `Retry-After` is sent | `Retry-After` is honoured when present, else the rate-limit reset headers; the value is recorded on the error and in telemetry. Nothing auto-retries a 429. | Capture redacted rate-limit headers and an authorised 429 response through a surface exposing raw HTTP headers; the recorded connector checks did not establish these values. |
| Analytics `start_date`/`end_date` format | `YYYY-MM-DD` is sent, with a one-day margin either side of the publish time. | An authorised analytics request confirming accepted date inputs. The connector used for these checks exposes no analytics call. |
| Comment-marker round-trip and whether PATCH with markers excluded is refused when comments exist | `force_overwrite_comments` is never sent. A provider refusal maps to `CONFLICT` or `VALIDATION_FAILED`, never to an overwrite. | The owner must create a comment thread in the Typefully UI on a labelled inert test draft, then authorise GET/PATCH checks of marker round-tripping and missing-marker refusal. The connector cannot create comment threads; the plain-text PATCH check does not settle this. |
| How the Typefully UI splits a thread | The adapter reads separate posts with a four-newline join and creates a single post with exact text. API multi-post representation and preview joining are verified above. | Inspect a labelled synthetic thread in the Typefully UI to establish its editor splitting rules; API array entries alone do not prove UI behaviour. |
| Whether `saves` is a number | Only a finite non-negative number is used; anything else leaves `Bookmarks` blank. | An authorised analytics response containing `saves` to inspect its type. The connector exposes no analytics call; a comment-thread test cannot close this item. |

## Idempotency design

The API has no idempotency key, so Content Studio cannot ask Typefully to dedupe. Instead (TYPE-02):

1. The key is `cs` plus a fingerprint of `operation id + Content ID`, never content text.
2. It is written into the new draft's `scratchpad_text` as `[cs-idem:<key>]`, a documented field the owner can see in Typefully's notes.
3. Before creating, the service looks for a recent draft carrying that marker. A retry of an operation whose response was lost therefore links the existing draft.
4. It then runs the reconciliation search (platform, Taipei time within 90 minutes, text similarity). Any candidate blocks creation; only no match allows it.
5. Within one server instance, concurrent calls with the same operation share one in-flight promise.

The fake gateway deliberately does **not** dedupe on the key, so the tests prove this lookup logic rather than a provider feature that does not exist.

## Provider metric matrix (PUB-02, PUB-05)

| Sheet column | X | LinkedIn | Threads |
| --- | --- | --- | --- |
| Views | `metrics.impressions` | blank (unavailable) | blank (unavailable) |
| Likes | `engagement.likes` | blank | blank |
| Reposts/Shares | `engagement.shares` (quotes not added) | blank | blank |
| Replies/Comments | `engagement.comments` | blank | blank |
| Bookmarks | `engagement.saves` when present | blank | blank |
| New Followers | blank: follower counts are per account per day, not per post | blank | blank |
| Post Link | `x_published_url` | `linkedin_published_url` | `threads_published_url` |
| Published At | `x_post_published_at`, else `published_at` | `linkedin_post_published_at` | `threads_post_published_at` |

Unavailable means the cell is left as it is: a blank stays blank and a value someone entered by hand is never erased. A provider zero is written as `0`.
