# Image pipeline (#243)

Heavy, already specified owner request. Content remains DB-only. Copyright
columns, enum parsing and import mapping are retained; gates, approval,
review filters, summary counts and UI no longer use them.

Acceptance contract:

- IMG-1: bounded Backlog page selection, count, select-all, maximum 25 per run,
  three concurrent requests, per-row outcomes and an explicit final summary.
- IMG-2: strict JSON image decision and one-line reason. Image-required posts
  receive an ASCII plan with title, 2–4 labelled blocks and arrows. Failed AI
  output leaves the existing decision untouched.
- IMG-3: all writes use the repository operation ledger, version CAS and audit.
  Sketch source stamps bind hook, draft and platform; approval additionally
  binds the exact sketch and brief. Changing source requires a revised plan.
- IMG-4: approval starts image creation. Create image can retry from an approved
  sketch; bulk Create images accepts only approved current sketches. Invalid or
  stale rows are separate failures and do not stop other selected rows.
- IMG-5: the mapper uses the original tool catalogue and validates final briefs
  in Python. All three model tasks (`image_check`, `ascii_sketch`, `image_render`)
  use the existing monthly usage admission/settlement path, including repairs.
  Refusal says `Monthly AI limit reached` before a provider call.
- IMG-6: private Python function, original renderer, OFL fonts, pinned
  dependencies, temporary files only, no subprocess. The Next server supplies
  the shared secret; it never enters client props, logs or health responses.
- IMG-7: new PNGs use Visuals' Drive asset upload and authenticated preview path.
  Brief/alt text, tool sidecar and SHA-256 are persisted with the post. Final
  image approval verifies the exact PNG bytes in Drive, separate from sketch
  approval. Images still require full-size and phone-width review.

Pipeline plans cannot use the historical SVG render or draft-preview actions.
Their small source stamp identifies them even in inventory projections that
omit `image_sketch`; mutation reads also fetch the fresh individual DB row.

Migration `20261027000400_image_pipeline.sql` is **unapplied**. It idempotently
adds `image_sketch text`, updates the guarded library mutation allowlist,
rebuilds the derived view and feature check constraint.
`20261027000500_content_summary_without_copyright.sql` removes copyright from
Needs Fix counts, including the retained historical Content SQL test chain.
Both preserve role grants, invoker security and history.
Apply only through the repository deployment workflow after review.

No new table or alternate content store. Image sketches are fetched on a
single-post read; they are omitted from inventory database projections and
bounded client Backlog rows. The 37-format mapper catalogue stays server-side.

The original tool supports English only and rejects unsupported glyphs,
punctuation or copy that does not fit. Errors identify the offending field
without returning its private contents. `image-renderer/AUTOMATION.md` contains
the format-specific field counts, caveats and chart evidence requirements.
The mapping task cannot verify facts or chart provenance; owner review remains
required. It does not alter the post's copy.

Configure IMAGE_RENDERER_SECRET on the deployment; APP_BASE_URL must point to
the same Next/Python deployment. The existing Drive write configuration and
asset folder are required. Missing configuration fails closed. Fake mode uses
synthetic AI and a tiny valid PNG through the same guarded save/Drive path.

Run Python checks with `python -m unittest discover -s tests/python -v` after
`python -m pip install -r requirements.txt`. The existing CI does not configure
Python, so this build documents that check instead of adding a new CI runtime.

Local Next builds do not verify Vercel's mixed Python/Next function discovery,
`includeFiles` packaging, deployment protection, or real Drive integration.
Verify the secret-protected `/api/render-image` route with synthetic copy on a
Vercel preview before enabling live rendering. No live provider calls are part
of this build. See `image-renderer/README.md` for provenance and runtime docs.

## Sketch options (#248)

One AI call per post (`image_check` for the Backlog bulk check, `image_need` for the
editor's one-click "Check with AI") decides the need and, when an image helps,
returns 1 to 3 ranked options: `{title, reason, layout, sketch}`. The count is
adaptive (one is fine), layouts are unique, each sketch is printable ASCII, at most
3000 characters and 40 lines, and a bad reply gets one repair. `layout` names a
relationship family that maps onto the renderer formats (`IMAGE_LAYOUTS` in
`src/domain/image-options.ts`); the render step still picks the final format.

Options are stored in `content_studio_posts.image_sketch_options` (jsonb array of
1 to 9, migration `20261028000200_image_sketch_options.sql`). `image_sketch` stays
the current, approved sketch. Actions on `/api/images`, all with the usual
operation id and expected revision:

- `check`: one call, saves the verdict and options; the best fit becomes the pending sketch.
- `store`: the one-click check saves the verdict and options it already holds; the server re-validates them. On a post that is already decided, has an image or has an approved sketch, only the options are saved.
- `choose`: approves one option (optionally with the owner's edited text). "Make image" runs `choose` then `create`.
- `more`: up to 3 further layouts not already shown (feature `ascii_sketch`), capped at 9 in total; an empty answer is "no other layout fits".
- `force`: "Needs an image anyway" on a no-image verdict drafts options.

Posts checked before options existed keep the single-sketch controls (approve,
revise, create).
