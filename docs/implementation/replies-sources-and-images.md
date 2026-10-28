# Replies: sources, earlier posts and images (#245)

Scope: the Replies tool only. The post editor is untouched.

## What the owner sees

Under each reply idea and under the editor there are two rows.

* **Used in this reply**: the facts and guide the reply draws on, each with an x.
* **More suggestions**: other matches, each with a +.

An x or a + calls the existing `POST /api/replies/refine` with the changed set and
returns a rewrite **preview**. Nothing changes in the editor until **Replace reply**.
**Keep my reply** discards the preview and puts the lists back.

Below the editor, **Images you have used** shows images that fit the post, with Copy
image and Download (`src/components/image-transfer.tsx`), plus **Create new**.

## Where suggestions come from (free, no model call)

Suggestions are found by `POST /api/replies/suggestions`, called on the same click as
Get reply ideas (and once more for the facts the ideas cite).

| Kind | Source | Rule |
| --- | --- | --- |
| Facts | `facts` | Approved, active and in date. `private_context_only` facts are offered with a small "private" tag; generation still excludes them on its own path. |
| Earlier posts | `content_studio_posts`, `collection = 'library'`, `deleted_at is null` | Bounded candidate query (`or` of `ilike` on `draft_content`, `current_hook`, `pesto`, `content_source`, 60 rows), ranked in TypeScript, at most 4 returned with a 280 character excerpt and at most 1500 characters of text. |
| Images | `reply_bank_images` plus images attached to Library posts | Matched together on tags, alt text, title and brief. At most 6 returned, each as a same-origin URL. |
| Guides | existing `resources` resolve | Unchanged. Insert uses `buildCta` and the `\n\n{cta} {url}` convention in `Workspace.onAddResource`. |

The response is parsed through `suggestionsResponseSchema` on the way out, so the
browser never receives the library, a Drive link, or a storage path.

## Refine request, extended

`refineRequestSchema` gains (all optional, so existing requests are unchanged):

* `action: 'use_sources'`
* `extra_fact_ids` (max 5), `extra_post_ids` (max 3), `excluded_fact_ids` (max 10)
* `idea_id`: rewrite a saved idea of this session instead of the draft

Only ids travel. The server reads the text itself from the owner's rows
(`Store.contextExtras`, `Store.getSuggestion`), so client text never reaches a prompt.
Extra facts must be approved, active and in date. Excluded facts are named in the
instruction and left out of the context the grounding guards read, so a rewrite that
still cites one is withheld (`unknown_fact`). Earlier posts go in as fenced `reference`
data after the reply and are never inserted wholesale.

## Image bank

* Migration: `supabase/migrations/20261028000100_reply_bank_images.sql` (unapplied).
  Three tables (`reply_bank_images`, `reply_bank_image_files`, `reply_bank_image_audit`),
  RLS on, service role only, size and shape checks. It also recreates
  `content_studio_ai_calls_feature_check` with every feature including
  `bank_image_tags`.
* Storage: bytes in `reply_bank_image_files.bytea` behind
  `GET /api/replies/images/:id/file`, which checks the owner session, re-sniffs the
  type, and sends `nosniff`, `default-src 'none'; sandbox` and a private cache header.
  Drive was not used: `DriveGateway.createFile` only accepts SVG and PNG.
* Upload: multipart, PNG/JPEG/WebP by magic bytes, at most 5 MB, owner and
  same-origin checked, a request key makes a repeat a replay.
* Tags: `POST /api/replies/images/suggest` is one small `bank_image_tags` AI call
  through the AI gateway, counted in the monthly cap ("Monthly AI limit reached" at the
  cap). The gateway is text only, so the model sees the file name and the owner's
  optional note, not the pixels. The owner edits everything before saving.
* Create new: `POST /api/replies/images/create` runs the existing `ascii_sketch` and
  `image_render` tasks and the `ImageRenderer` port in the order sketch, (revise),
  approve, create. Approval is a stamp of the exact sketch text; the render is refused
  without it. The finished PNG is saved to the bank.

## Costs

Finding suggestions is free. Rewrites with changed sources, upload tags, sketches and
renders each use the AI gateway and are counted in the cap. A repeated request key
shares the first call (`src/replies/lib/server/ai-memo.ts`).

## Verification

Unit, component and route tests live under `tests/replies/unit` and `tests/unit`. The
Playwright journey is `tests/e2e/replies-sources.spec.ts` (375 and 1280, fake
providers). Run the migration test with `tests/unit/supabase/reply-bank-images-sql.test.ts`.

## Known limits

* Vercel caps a serverless request body at about 4.5 MB, below the 5 MB application
  limit. A larger upload is refused by the platform before the route sees it.
* Post images are shown through the existing `/api/library/:id/asset` route, which
  reads Drive. A post whose file cannot be read shows a broken thumbnail.
