import { describe, expect, it } from 'vitest';
import {
  LIBRARY_HEADERS,
  SCHEDULE_HEADERS,
  discoverHeaders,
  toLibraryRecord,
  toScheduleRecord,
  columnLetter,
  type LibraryField,
} from '@/domain';
import { LIBRARY_ORDER, SCHEDULE_ORDER, syntheticLibraryRows, syntheticScheduleRows } from '@/fixtures/synthetic';

describe('MAP-01: every current header maps exactly once', () => {
  it('Content Library and Ready Queue have 33 mapped headers, all distinct', () => {
    const headers = Object.values(LIBRARY_HEADERS);
    expect(headers).toHaveLength(33);
    expect(new Set(headers).size).toBe(33);
    expect(LIBRARY_ORDER).toHaveLength(33);
    expect(new Set(LIBRARY_ORDER).size).toBe(33);
  });

  it('Content Schedule has 44 mapped headers, all distinct', () => {
    const headers = Object.values(SCHEDULE_HEADERS);
    expect(headers).toHaveLength(44);
    expect(new Set(headers).size).toBe(44);
    expect(new Set(SCHEDULE_ORDER).size).toBe(44);
  });

  it('A:AG and A:AR are exactly the discovered widths', () => {
    expect(columnLetter(32)).toBe('AG');
    expect(columnLetter(43)).toBe('AR');
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(26)).toBe('AA');
  });
});

describe('MAP-02 / MAP-04: header discovery by name', () => {
  const header = LIBRARY_ORDER.map((f) => LIBRARY_HEADERS[f]);

  it('works when columns are reordered and unknown columns are added', () => {
    const reordered: string[] = [...header].reverse();
    reordered.splice(5, 0, 'Owner notes');
    const result = discoverHeaders(LIBRARY_HEADERS, reordered);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.index.passthrough).toEqual([{ header: 'Owner notes', column: 5 }]);
    expect(reordered[result.index.columns.libraryId]).toBe('Library ID');
  });

  it('reports a renamed column as missing (schema drift)', () => {
    const renamed = header.map((h) => (h === 'Review Status' ? 'Review state' : h));
    const result = discoverHeaders(LIBRARY_HEADERS, renamed);
    expect(result).toEqual({ ok: false, problems: [{ kind: 'missing', header: 'Review Status' }] });
  });

  it('reports a duplicated required header', () => {
    const dup = [...header, 'Draft Content'];
    const result = discoverHeaders(LIBRARY_HEADERS, dup);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]).toMatchObject({ kind: 'duplicate', header: 'Draft Content' });
  });

  it('tolerates trailing spaces in a header cell', () => {
    const spaced = header.map((h) => (h === 'PESTO' ? 'PESTO  ' : h));
    expect(discoverHeaders(LIBRARY_HEADERS, spaced).ok).toBe(true);
  });
});

describe('row mapping', () => {
  const [head, ...rows] = syntheticLibraryRows();
  const found = discoverHeaders(LIBRARY_HEADERS, head!.values);
  if (!found.ok) throw new Error('fixture header drift');
  const index = found.index;

  it('parses live vocabulary into canonical enums', () => {
    const rec = toLibraryRecord(index, rows[0]!, 2);
    expect(rec.value.copyrightQa).toEqual({ ok: true, value: 'PASS' });
    expect(rec.value.duplicateQa).toEqual({ ok: true, value: 'PASS' });
    expect(rec.value.reviewStatus).toEqual({ ok: true, value: 'Pending' });
    expect(rec.value.queueForSchedule).toBe(false);
    expect(rec.value.state).toBe('Editing');
  });

  it('extracts hyperlink targets and formula fields', () => {
    const rec = toLibraryRecord(index, rows[0]!, 2);
    expect(rec.cells.sourceMarkdown).toBe('Open master');
    expect(rec.links.sourceMarkdown).toMatch(/^https:\/\/drive\.google\.com\/file\/d\/SYNTH/);
    expect(rec.formulaFields).toContain('hasImage');
    expect(rec.formulaFields).toContain('sourceMarkdown');
    expect(rec.formulaFields).not.toContain('draftContent');
  });

  it('keeps exact text including CJK, emoji, trailing spaces and blank lines', () => {
    const l8 = rows.map((r) => toLibraryRecord(index, r, 0)).find((r) => r.value.libraryId === 'SYN-L008')!;
    expect(l8.value.draftContent).toBe('談薪水不是吵架 🙂\n\nIt is a joint problem:\n  – their budget\n  – your market value\n\nEnd with a question, not a demand.  ');
  });

  it('revision changes when a pass-through column changes', () => {
    const withExtra = { values: [...rows[0]!.values, 'note A'] };
    const changed = { values: [...rows[0]!.values, 'note B'] };
    const idx = { ...index, width: index.width + 1 };
    expect(toLibraryRecord(idx, withExtra, 2).revision).not.toBe(toLibraryRecord(idx, changed, 2).revision);
  });

  it('parses schedule rows with header row 2 and slot vocabulary', () => {
    const [, sHead, ...sRows] = syntheticScheduleRows();
    const s = discoverHeaders(SCHEDULE_HEADERS, sHead!.values);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const recs = sRows.map((r, i) => toScheduleRecord(s.index, r, i + 3));
    const pub = recs.find((r) => r.value.contentId === '2026-10-01-MAIN-X')!;
    expect(pub.value.typefullyStatus).toEqual({ ok: true, value: 'Published' });
    expect(pub.value.metrics.replies).toBe(0);
    expect(pub.value.metrics.newFollowers).toBeNull();
    expect(pub.value.slot).toBe('Main');
    const empty = recs.find((r) => r.value.contentId === '2026-10-03-3RD-X')!;
    expect(empty.value.typefullyStatus).toEqual({ ok: true, value: 'Not Sent' });
  });
});

describe('SEC-02: untrusted values never select an unlisted path', () => {
  it('unknown enum text parses as unrecognised, never a default', () => {
    const [head, ...rows] = syntheticLibraryRows();
    const found = discoverHeaders(LIBRARY_HEADERS, head!.values);
    if (!found.ok) throw new Error('drift');
    const cols = found.index.columns as Record<LibraryField, number>;
    const values = [...rows[0]!.values];
    values[cols.copyrightQa] = 'constructor';
    values[cols.targetPlatform] = '__proto__';
    const rec = toLibraryRecord(found.index, { values }, 2);
    expect(rec.value.copyrightQa.ok).toBe(false);
    expect(rec.value.targetPlatform.ok).toBe(false);
  });
});
