# Typefully API facts (CS-015/016)

Researched 2026-09-23 from the public documentation only: <https://typefully.com/docs/api> (API v2 reference), the Typefully Help Center article "Typefully API v1 to v2 migration guide" and the Typefully changelog. The live API was **not** called and no Typefully MCP tool was used, so the owner's account was never touched. Anything marked **unverified** was not stated in those sources; the adapter is designed so that being wrong about it fails safe (a refusal or a conflict, never a duplicate or an overwrite). Tier T3 verification against an authorised test social set must confirm each unverified item before live writes are enabled.

## Confirmed from the documentation

| Topic | Fact | Used in |
| --- | --- | --- |
| Base URL | `https://api.typefully.com`, path prefix `/v2` (OpenAPI version 2.0.0). No version header. | `TYPEFULLY_BASE_URL` |
| Auth | `Authorization: Bearer <API key>` on every request. | `LiveTypefullyGateway.once` |
| Social sets | `GET /v2/social-sets` (limit/offset), `GET /v2/social-sets/{social_set_id}/`. Everything else is scoped to one social set. | env `TYPEFULLY_SOCIAL_SET_ID` |
| List drafts | `GET /v2/social-sets/{id}/drafts`; filters `status` (`draft`, `published`, `scheduled`, `planned`, `error`, `publishing`), `tag`; `order_by` one of `created_at`, `updated_at`, `scheduled_date`, `published_at` with optional `-` prefix. Pagination `limit` (default 10, max 50) and `offset`; response `results`, `count`, `limit`, `offset`, `next`, `previous`. **No date-range filter.** | `listDrafts`, `findByIdempotencyKey` |
| Get draft | `GET /v2/social-sets/{id}/drafts/{draft_id}`, query `exclude_comment_markers`. Response carries per-platform `platforms.<p>.posts[].text`. | `getDraft` |
| Create draft | `POST /v2/social-sets/{id}/drafts` (201). Body `platforms: { x | linkedin | threads | ...: { enabled, posts: [{ text }] } }`, optional `draft_title`, `scratchpad_text`, `tags`, `share`, and **either** `publish_at` (`now`, `next-free-slot` or ISO 8601 with offset) **or** `plan_at` (dated but inert, never auto-publishes). | `createDraft` |
| Update draft | `PATCH /v2/social-sets/{id}/drafts/{draft_id}` with the same body shape; `force_overwrite_comments` (default false); comment markers must round-trip. | `updateDraft` |
| Delete draft | `DELETE .../drafts/{draft_id}` (204). Not used. | none |
| Draft fields | `id` (integer), `status` (`draft`, `scheduled`, `planned`, `publishing`, `published`, `error`), `scheduled_date` and `published_at` (UTC ISO or null), `created_at`, `updated_at`, `publish_state`, `private_url`, `share_url`, `scratchpad_text`, and per platform `<p>_post_enabled`, `<p>_published_url`, `<p>_post_published_at` for `x`, `linkedin`, `threads` (and others). | `toDraft` |
| Idempotency | **None.** No idempotency key or duplicate prevention is documented. | see design below |
| Analytics | `GET /v2/social-sets/{id}/analytics/{platform}/posts` with required `start_date`, `end_date`, optional `include_replies`, `limit` (max 100), `offset`. **Only `x` is supported.** Per post: `post_id`, `platform`, `created_at`, `preview_text`, `url`, optional `draft_id`, `metrics.impressions`, `metrics.engagement.{likes, shares, comments, quotes, profile_clicks, total}`, optional `link_clicks` and `saves`. `GET .../analytics/{platform}/followers` gives daily follower counts per account, not per post. | `getPublication` |
| Rate limits | 429 on excess. Headers `X-RateLimit-User-{Limit,Remaining,Reset}` and `X-RateLimit-SocialSet-{Limit,Remaining,Reset,Resource}`; reset is a Unix timestamp. | `retryAfter` |
| Errors | `{ "error": { "code", "message", "details" } }`; statuses 400, 401, 402, 403, 404, 409, 422, 429, 503. | `mapStatus` |

## Unverified (designed around)

| Point | Design response |
| --- | --- |
| Numeric rate limits and whether `Retry-After` is sent | `Retry-After` is honoured when present, else the rate-limit reset headers; the value is recorded on the error and in telemetry. Nothing auto-retries a 429. |
| Whether list items include `platforms[].posts[].text` and `scratchpad_text` | If a list item lacks text the adapter fetches the full draft; if it lacks `scratchpad_text` it fetches up to 10 recent drafts to read the marker. |
| Whether `scheduled_date` holds the date of a `planned` draft | Assumed yes. If not, planned drafts are invisible to the time-window search, so the lookup by idempotency marker is the guard for our own drafts and a human reconciles others. |
| Where nulls sort under `order_by=-scheduled_date` | Undated drafts are skipped for time matching. The scan stops only after passing the window; it refuses (`PROVIDER_UNAVAILABLE`, `candidate_scan_truncated`) rather than silently stopping after 20 pages. |
| Analytics `start_date`/`end_date` format | `YYYY-MM-DD` is sent, with a one-day margin either side of the publish time. |
| Whether PATCH with markers excluded is refused when comments exist | `force_overwrite_comments` is never sent. A provider refusal maps to `CONFLICT` or `VALIDATION_FAILED`, never to an overwrite. |
| How the Typefully UI splits a thread | Posts are joined with four newlines when read as one text; created drafts always send a single post with the exact text. |
| Whether `saves` is a number | Only a finite non-negative number is used; anything else leaves `Bookmarks` blank. |

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
