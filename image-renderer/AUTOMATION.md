# SOAR diagram automation

Run from `D:/wt/soar-diagrams/out/soar-diagrams/`. Requires the existing Python environment with Pillow and fontTools and the three local TTFs in `fonts/`. No network, npm or model is used.

## Usage

```powershell
python pick.py "Weak vs strong resume bullet"
python pick.py "Who has the final say?" --shape authority
python make.py --spec briefs/01-resume-bullet.json
python make.py --batch briefs
python make.py --batch briefs --out examples-output
python -m unittest -v test_make
python verify_new.py
```

Copy one of the six briefs, choose a format, and replace the title, fields and alt text. No coordinates or font sizes are accepted in a brief. E03 wraps and places 2-4 steps. Other formats use the exact small item counts below. Text wraps automatically and container text is centred by visible glyph bounds. If text cannot fit, the command fails with the offending label. Shorten copy or choose a format with more room.

Paths passed to `--spec` and `--batch` are relative to the current directory. Batch reads top-level `.json` files in sorted filename order, continues after a failed brief, and returns 1 if any brief fails. Empty batches fail. `--spec` and `--batch` are mutually exclusive. `--out` also works with batch and must resolve inside this scratch folder. Default output is `generated/`. Original catalogue PNG paths are protected from overwrites.

Each success writes `<format>-<title-slug>.png`, a matching `.json`, and appends one JSON line to `manifest.jsonl` in the output directory. Rerunning the same title replaces its PNG and sidecar and adds a fresh manifest record. Use different titles or output directories to retain variants. Run one process per output directory.

The sidecar holds the complete resolved brief and layout, checks passed, SHA-256, UTC render time, elapsed seconds and `SOAR-clean-editorial-v2.4.1 / <layout-id> / r01 / <platform> / en`. PNGs are deterministic in this local font/Pillow environment. Sidecar timestamps are deliberately different on each run. `visual_review: not automated` distinguishes geometry checks from an actual visual review.

## Brief envelope

```json
{
  "format": "E02",
  "title": "Make a resume bullet clear",
  "fields": {"before": "Helped with reports", "after": "Built a weekly sales report so the team could spot late orders"},
  "example_label": "Illustrative example",
  "alt_text": "An example bullet changes from a vague claim to a clear task and purpose.",
  "platform": "linkedin",
  "language": "en"
}
```

All envelope keys except `example_label` are required. Unknown envelope or nested field names fail with their full path. Strings must be non-empty. `language` accepts only `en`. `platform` accepts `linkedin`, `x`, `threads` and `instagram`. Titles use Outfit 700 at 72 px and cannot end with a full stop. All copy rejects em dashes, semicolons, unsupported font glyphs and control characters. English is a language declaration, not language detection. Keep British English, short everyday wording and one lesson.

## Fields by format

`string[3]` means exactly three strings. `{...}[3]` means exactly three objects with the named fields. All shown fields are required, and extra fields fail. Counts are deliberately capped by the template. Copy order follows reading order unless noted below.

| Format | Required `fields` | `example_label` |
| --- | --- | --- |
| E01 | `{options: string[2], rows: {dimension: string, left: string, right: string}[3]}` | Required |
| E02 | `{before: string, after: string}` | Required |
| E03 | `{steps: string[2..4]}` | Omit |
| E04 | `{question: string, yes_label: string, no_label: string, yes_action: string, no_action: string, caveat: string}` | Omit |
| E05 | `{parts: string[3], callouts: string[3]}` | Required |
| E06 | `{sources: string[3], result: string}` | Omit |
| E07 | `{rows: {label: string, prompt: string}[3]}` | Omit |
| E08 | `{profile: string, control: string, annotation: string, visibility_label: string, setting: string, caveat: string}` | Required |
| E09 | `{proof_heading: string, rows: {need: string, proof: string}[3]}` | Required |
| E10 | `{asker: string, question: string, speaker: string, answer: string}` | Required |
| N01 | `{caveat: string, x_axis: string, y_axis: string, cells: string[4]}` | Omit |
| N02 | `{low: string, high: string, positions: string[3]}` | Required |
| N03 | `{caveat: string, stages: string[3]}` | Omit |
| N04 | `{steps: string[3], repeat: string}` | Omit |
| N05 | `{milestones: {day: string, task: string}[4]}` | Omit |
| N06 | `{levels: string[4], caveat: string}` | Omit |
| N07 | `{stated: string, ask_heading: string, questions: string}` | Required |
| N08 | `{sets: string[3], overlap: string}` | Omit |
| N09 | `{layers: {label: string, copy: string}[3]}` | Required |
| N10 | `{claim: string, proofs: string[3]}` | Required |
| X02 | `{headings: string[3], rows: {need: string, status: string, next: string}[3]}` | Required |
| X03 | `{need: string, weak_proof: string, problem: string, repair: string}` | Required |
| X04 | `{inputs: string[3], result: string}` | Omit |
| X05 | `{start: string, routes: string[3], goal: string}` | Required |
| X06 | `{goal: string, proof: string, task: string, start_label: string, direction_label: string}` | Omit |
| X08 | `{broad: string, context: string, specific: string}` | Required |
| X10 | `{caveat: string, causes: {label: string, question: string}[4], effect: string}` | Omit |
| X11 | `{centre: string, people: string[4]}` | Omit |
| X12 | `{cells: {label: string, copy: string}[4]}` | Required |
| X14 | `{rows: {action: string, copy: string}[3]}` | Omit |
| X15 | `{stages: {label: string, copy: string}[3]}` | Required |
| X16 | `{goal: string, pillars: string[3], foundation: string}` | Omit |
| NEW-01 | `{lanes: {role: string, step: string}[4]}` | Required |
| NEW-02 | `{person: string, ai: string, supply: string, approve: string, check: string, draft: string, revision_label: string}` | Required |
| NEW-03 | `{steps: {kind: string, label: string}[6]}` | Required |
| NEW-04 | `{measure: string, groups: {label: string, count: number}[2], base_count: number, unit: string}` | Required |
| NEW-05 | `{cohort: string, window: string, base_count: number, stages: {label: string, count: number}[4]}` | Required |

Example caveats must contain the word Example or Schematic. They are displayed in the layout, not just metadata. E08 must describe a schematic, never a real captured interface. E09 uses `example_label` as its first column heading (for example, "Example need") and `proof_heading` as its second heading. E02 keeps the fixed Before and After labels. N01 cells are top-left, top-right, bottom-left, bottom-right. N06 levels are bottom to top, from helped through owned. NEW-02 slots are person, AI, facts supplied, approval, check, draft, return-arrow label. The person is the final approver, and the return arrow goes from check to draft. Keep both outcomes clear in the copy.

N05 uses real equally spaced days `Day -7`, `Day -5`, `Day -3`, `Day -1` in order. Other dates require a different layout. NEW-03 steps read across the top row, then back across the bottom row. `kind` accepts Work or Wait, sets the fill/outline automatically, and its caveat must also say Not to scale.

NEW-04 counts share one positive `base_count`. Displayed percentages and bar widths are calculated from count/base. Its `example_label` must also say to replace the data (for example, "Example data. Replace with a sourced number."). The denominator line is generated from the base and unit. NEW-05 accepts raw counts for four ordered stages. Its first count must equal `base_count`, later counts must not increase, and all must stay within the base. Counts can be zero. The same base controls every bar. Both charts use forest green #0A3D26 on pale #E7EFE9 tracks. These chart templates are explicitly labelled examples. Replace all related fields together after checking sources. They do not offer a switch that silently removes the caveat for live data.

## Checks and presets

- All three real font files must exist and have the expected Outfit/Manrope families. Family names are printed. No font fallback or missing-glyph substitution.
- Body and labels are at least 40 px. The established SOAR footer is 28 px. Cards centre text from visible glyph bounds with 24 px internal padding.
- Actual glyphs stay inside the 64 px safe margin and at least 20 px from any registered outline, arrowhead or connector. Distinct text blocks need 20 px clearance. Normal line spacing within one paragraph is checked for overlap, not treated as separate labels needing 20 px.
- Text overflow, including an overlong word that cannot wrap, fails. Rendered PNG size, RGB mode and PNG encoding are checked before any output is written.
- Schema, English-only language setting, caveat and numeric checks run before output. Any failure exits non-zero and prints the reason. Batch keeps successful briefs and reports failures.
- Safe margin and canvas dimensions come from `presets.json`. All four current presets are exactly 1080 x 1350. The table allows future dimensions and margins to be entered without editing CLI code. Square and story layouts are not implemented or validated. Their geometry still needs an authored design and QA before use.

`render.py` owns font loading, metrics, centring, drawing and geometry checks. `formats.py` binds named copy fields to deep copies of the authored `specs.json` layouts. Original geometry is resolved before replacing text so a new label cannot move circles or hand-off routes. Both entry points call the same `render.render()` function. `python render.py --new` regenerates only the five extras and their separate contact sheets. Do not use `--only` with an original ID during this preservation task.

## Format picker

`pick.py` parses routing gate section 1, the topic tables in 2a and 2b, and the catalogue shape table in section 4 of `FORMAT-TOPIC-MAP-v2.md`. It matches normalised words with a small explicit synonym list. A topic needs at least two matching words including a distinctive word, or an explicit shape match. Ties follow map order. Shape matching can use section 4 when there is no core topic, such as overlap. The five proposed layout names map to NEW-01 through NEW-05.

It prints a primary and runner-up when the map supplies a useful one. A missing safe runner-up is shown as none. Text-only, screenshot and reconstructed-document primaries remain those routes instead of being turned into diagrams. Unmatched lessons print `no good match: consider text only / screenshot / new layout`. Chart suggestions print the data gate. This is a keyword helper, not semantic advice. It cannot inspect evidence or decide whether a claimed relationship is true. Review the matched topic and the map's conditions before choosing.

## Adding a format

1. Add an authored spec to `specs.json`, with a unique ID, slug, exact copy, alt text and layout. Reuse `render.py` primitives, 72 px title, 40+ px body, 24 px corners and 8 px geometry. For a new silhouette, use a small layout function such as `sequence_layout` or `new_types.catalogue`.
2. Add its strict fields to `formats.SCHEMAS` and a complete binding in `resolved_spec`. Bind every body text slot. Add it to `EXAMPLE` if it has an example caveat slot. If quantities affect geometry, derive widths from validated numeric fields rather than copy text.
3. Add an example brief and a success/failure test. Update the ID-count test if the catalogue grows. Update the map and picker alias only when the map uses a new prose name.
4. Run the light Python tests, render the brief, open the PNG at full size and 390 px, and update this schema table and REPORT.md. Never modify or render the preserved original PNG files to try a new format. Use a separate output directory.

## Known limits and evidence

The layouts accept concise copy within fixed small item counts. They do not shrink text or invent copy. In particular N08's centre is very small: use a short word such as Fit. Long titles or labels can fail and need shorter copy. There is no automated grade-level check, British-English dictionary, factual check, chart source verification, or visual judgement. Examples remain labelled, and E08's current LinkedIn menu wording is unverified offline. No network, screenshot capture, language translation or other canvas size is implemented. Broader layouts and live-data chart modes need explicit design work.

The six briefs were batch-rendered into `generated/`, inspected individually at 1080 x 1350 and 390 px, and pass the shared checks. `contact-sheet-examples.png` and `contact-sheet-examples-390.png` show this batch. Individual previews are `qa/example-*.png`. `test_make.py` covers schemas, nested field errors, CLI failure, collision, missing font, long-copy rejection before writing, 2-4 step sequences, chart geometry including zero, four presets, original preservation, 37 schema bindings and deterministic PNG/sidecar/manifest success. `qa/automation-verification.json` records final output hashes and preservation evidence.
