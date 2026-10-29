import { describe, expect, it } from 'vitest';
import { MAX_OPTIONS, MAX_SKETCH_CHARS, MAX_SKETCH_LINES, appendOptions, draftProblems, imageOptionDraftSchema, normaliseDrafts, normaliseSketch, optionId, optionsPatchValue, parseStoredOptions, type ImageLayout, type ImageOptionDraft } from '@/domain/image-options';
import { imageActionSchema, imageDecisionSchema } from '@/domain/image-pipeline';

const draft = (layout: ImageLayout, n = 0): ImageOptionDraft => ({ title: `Option ${layout}`, reason: 'It fits the post.', layout, sketch: `Title ${n}\n+------+\n| Step |\n+------+` });
const LAYOUTS: ImageLayout[] = ['steps', 'comparison', 'before_after', 'decision', 'quadrant', 'timeline', 'ladder', 'layers', 'overlap', 'funnel', 'spectrum'];

describe('image option drafts (#248)', () => {
  it('accepts a single-line title and reason, a known layout and a sketch; rejects anything else', () => {
    expect(imageOptionDraftSchema.safeParse(draft('steps')).success).toBe(true);
    for (const bad of [{ ...draft('steps'), layout: 'pie' }, { ...draft('steps'), title: '' }, { ...draft('steps'), title: 'a\nb' }, { ...draft('steps'), reason: 'x'.repeat(161) },
      { ...draft('steps'), sketch: '' }, { ...draft('steps'), extra: 1 }]) expect(imageOptionDraftSchema.safeParse(bad).success).toBe(false);
  });
  it('the decision allows no options, 1, 2 or 3, but never 4', () => {
    for (const n of [0, 1, 2, 3]) expect(imageDecisionSchema.safeParse({ needsImage: n > 0, reason: 'r', options: LAYOUTS.slice(0, n).map(l => draft(l)) }).success).toBe(true);
    expect(imageDecisionSchema.safeParse({ needsImage: true, reason: 'r', options: LAYOUTS.slice(0, 4).map(l => draft(l)) }).success).toBe(false);
    expect(imageDecisionSchema.parse({ needsImage: false, reason: 'r' }).options).toEqual([]);
  });
  it('normalises a sketch to printable ASCII with trimmed lines', () => {
    expect(normaliseSketch('\n\n  A → B   \r\n\tC—D é\n\n')).toBe('  A -> B\n    C-D');
  });
  it('flags empty, over-long and over-tall sketches and duplicate or already shown layouts, by path only', () => {
    expect(draftProblems(normaliseDrafts([{ ...draft('steps'), sketch: ' ' }]), { max: 3 })).toEqual(['options.0.sketch: too short']);
    expect(draftProblems([{ ...draft('steps'), sketch: 'x'.repeat(MAX_SKETCH_CHARS + 1) }], { max: 3 }).join()).toContain('over 3000 characters');
    expect(draftProblems([{ ...draft('steps'), sketch: Array.from({ length: MAX_SKETCH_LINES + 1 }, () => 'row').join('\n') }], { max: 3 }).join()).toContain('lines');
    expect(draftProblems([draft('steps'), draft('steps', 1)], { max: 3 })).toEqual(['options.1.layout: duplicate or already shown']);
    expect(draftProblems([draft('steps'), draft('comparison', 1)], { max: 3, exclude: ['comparison'] })).toEqual(['options.1.layout: duplicate or already shown']);
    expect(draftProblems([], { min: 1, max: 3 })).toEqual(['options: return at least 1']);
    expect(draftProblems(LAYOUTS.slice(0, 4).map((l, n) => draft(l, n)), { max: 3 })).toEqual(['options: return at most 3']);
    expect(draftProblems([draft('steps'), draft('comparison', 1)], { min: 1, max: 3 })).toEqual([]);
    expect(draftProblems([draft('steps'), draft('comparison')], { max: 3 })).toEqual(['options.1.sketch: identical to another option']);
  });
  it('stores options with content ids, skips repeats and never passes nine', () => {
    const first = appendOptions([], [draft('steps'), draft('comparison')]);
    expect(first.map(o => o.id)).toEqual([optionId(draft('steps')), optionId(draft('comparison'))]);
    expect(appendOptions(first, [draft('steps'), draft('decision')]).map(o => o.layout)).toEqual(['steps', 'comparison', 'decision']);
    const many = appendOptions([], LAYOUTS.map(l => draft(l)));
    expect(many).toHaveLength(MAX_OPTIONS);
    expect(appendOptions(many, [draft('spectrum'), draft('funnel')])).toHaveLength(MAX_OPTIONS);
  });
  it('round-trips through the column value and ignores a damaged one', () => {
    const options = appendOptions([], [draft('steps')]);
    expect(parseStoredOptions(JSON.parse(optionsPatchValue(options)))).toEqual(options);
    expect(parseStoredOptions(optionsPatchValue(options))).toEqual(options);
    expect(optionsPatchValue([])).toBe('');
    for (const bad of [null, undefined, '{', [{ id: 'x' }], 'nope']) expect(parseStoredOptions(bad)).toEqual([]);
  });
  it('the action schema ties options, option ids and edited sketches to their own actions', () => {
    const base = { libraryId: 'SYN-L001', expectedRevision: 'a'.repeat(16), operationId: 'image_op_1' };
    expect(imageActionSchema.safeParse({ ...base, action: 'store', reason: 'Why.', options: [draft('steps')] }).success).toBe(true);
    expect(imageActionSchema.safeParse({ ...base, action: 'store', reason: 'Why.', options: LAYOUTS.slice(0, 4).map(l => draft(l)) }).success).toBe(false);
    expect(imageActionSchema.safeParse({ ...base, action: 'store' }).success).toBe(false);
    expect(imageActionSchema.safeParse({ ...base, action: 'check', options: [draft('steps')] }).success).toBe(false);
    expect(imageActionSchema.safeParse({ ...base, action: 'choose', optionId: 'abcdef01', sketch: 'edited' }).success).toBe(true);
    expect(imageActionSchema.safeParse({ ...base, action: 'choose' }).success).toBe(false);
    expect(imageActionSchema.safeParse({ ...base, action: 'more', optionId: 'abcdef01' }).success).toBe(false);
    expect(imageActionSchema.safeParse({ ...base, action: 'more' }).success).toBe(true);
  });
});
