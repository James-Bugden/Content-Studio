import { beforeEach, describe, expect, it } from 'vitest';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { FakeDriveGateway } from '@/integrations/google/fake-drive';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import {
  approveRevision,
  assetFileName,
  checkScreenshot,
  decideVisual,
  loadVisualItem,
  loadVisualItems,
  renderRevision,
  saveBrief,
  type VisualOutcome,
} from '@/application/visuals';
import { evaluateLibraryGates } from '@/domain/gates';
import { parseBrief, type VisualBrief } from '@/domain/visual';
import { renderBriefSvg } from '@/domain/visual-render';
import type { VisualItemView } from '@/domain/visual-studio';
import { LIBRARY_HEADERS, SHEET_TABS } from '@/domain/sheet-schema';
import type { Actor } from '@/domain/mutation';
import { COMPLETE_BRIEF, LIBRARY_ORDER, syntheticLibraryRows } from '@/fixtures/synthetic';

/**
 * CS-012 Visual Studio services against the synthetic fakes (VIS-02, VIS-04,
 * VIS-05, VIS-06). Every write goes through the real repository contract.
 */
const owner: Actor = { sub: '100000000000000000001', role: 'owner' };
const viewer: Actor = { sub: '100000000000000000002', role: 'viewer' };
const complete = parseBrief(COMPLETE_BRIEF) as VisualBrief;

let sheet: FakeSheetTransport;
let repo: SheetsContentRepository;
let drive: FakeDriveGateway;
let n = 0;

beforeEach(() => {
  sheet = new FakeSheetTransport();
  repo = new SheetsContentRepository(sheet);
  drive = new FakeDriveGateway();
});

const op = () => `op_vis_test_${(n += 1)}`;
const view = async (id: string) => (await loadVisualItem(repo, id)).item;
async function cells(id: string) {
  return (await repo.getLibrary(id)).cells;
}
function ok(o: VisualOutcome): VisualItemView {
  if (!o.ok) throw new Error(`expected ok, got ${o.code}: ${o.message ?? ''}`);
  return o.item;
}
function sheetEdit(libraryId: string, header: string, value: string) {
  const grid = sheet.rawTab(SHEET_TABS.library.name);
  const head = grid[0]!.map((c) => c.value);
  const row = grid.findIndex((r) => r[head.indexOf(LIBRARY_HEADERS.libraryId)]?.value === libraryId);
  sheet.externalEdit(SHEET_TABS.library.name, row + 1, head.indexOf(header), value);
}

async function decide(id: string, decision: Parameters<typeof decideVisual>[2]['decision']) {
  const v = await view(id);
  return decideVisual(repo, owner, { operationId: op(), libraryId: id, expectedRevision: v.revision, decision });
}
async function brief(id: string, b: Partial<VisualBrief>) {
  const v = await view(id);
  const input = { ...complete, caveat: '', ...b } as VisualBrief;
  return saveBrief(repo, owner, { operationId: op(), libraryId: id, expectedRevision: v.revision, brief: { ...input, caveat: input.caveat ?? '' } });
}
async function render(id: string) {
  const v = await view(id);
  return renderRevision(repo, drive, owner, { operationId: op(), libraryId: id, expectedRevision: v.revision });
}
async function approve(id: string, over: Partial<{ version: string; fileHash: string; material: string }> = {}) {
  const v = await view(id);
  return approveRevision(repo, drive, owner, { operationId: op(), libraryId: id, expectedRevision: v.revision, version: v.version, fileHash: v.fileHash, material: v.material, ...over });
}

/** SYN-L001 (LinkedIn, Text only) moved to a rendered, reviewable original graphic. */
async function renderedL001() {
  ok(await decide('SYN-L001', 'original_graphic'));
  ok(await brief('SYN-L001', {}));
  return ok(await render('SYN-L001'));
}

describe('VIS-02: decisions and brief completeness', () => {
  it('Text only is a complete decision with no visual blockers and no approval needed', async () => {
    const l001 = await view('SYN-L001');
    expect(l001.decision).toBe('text_only');
    expect(l001.gates).toEqual([]);
    expect(l001.needsAction).toBe(false);

    const moved = ok(await decide('SYN-L007', 'text_only'));
    expect(moved.decision).toBe('text_only');
    expect(moved.imageStatus).toBe('Not Needed');
    expect(moved.gates).toEqual([]);
    expect((await cells('SYN-L007')).visualSource).toBe('Text only');
  });

  it('five main ideas or a missing field keeps Needs Brief and cannot render', async () => {
    ok(await decide('SYN-L001', 'original_graphic'));
    expect((await cells('SYN-L001')).imageStatus).toBe('Needs Brief');

    const five = ok(await brief('SYN-L001', { mainIdeas: ['One', 'Two', 'Three', 'Four', 'Five'] }));
    expect(five.imageStatus).toBe('Needs Brief');
    expect(five.briefProblems.map((p) => p.field)).toContain('mainIdeas');
    expect(five.canRender.ok).toBe(false);
    const refused = await render('SYN-L001');
    expect(refused).toMatchObject({ ok: false, code: 'GATE_BLOCKED' });
    expect(drive.created).toHaveLength(0);

    const noAlt = ok(await brief('SYN-L001', { altText: '' }));
    expect(noAlt.imageStatus).toBe('Needs Brief');
    expect(noAlt.briefProblems.map((p) => p.field)).toContain('altText');
    expect(await render('SYN-L001')).toMatchObject({ ok: false, code: 'GATE_BLOCKED' });

    const one = ok(await brief('SYN-L001', { mainIdeas: ['Only one'] }));
    expect(one.imageStatus).toBe('Needs Brief');

    const good = ok(await brief('SYN-L001', {}));
    expect(good.imageStatus).toBe('Brief Ready');
    expect(good.canRender).toEqual({ ok: true, nextVersion: 'SOAR-v1.1 / r01 / LinkedIn / en' });
    expect(JSON.parse((await cells('SYN-L001')).imageBrief)).toMatchObject({ grammar: 'contrast', mainIdeas: complete.mainIdeas });
  });

  it('a brief cannot be written before choosing Original graphic', async () => {
    expect(await brief('SYN-L001', {})).toMatchObject({ ok: false, code: 'GATE_BLOCKED' });
  });

  it('the incomplete brief row in the fixtures is listed as needing action', async () => {
    const list = await loadVisualItems(repo);
    const l007 = list.items.find((i) => i.libraryId === 'SYN-L007')!;
    expect(l007.needsAction).toBe(true);
    expect(l007.gates.map((g) => g.code)).toContain('VISUAL_BRIEF_INCOMPLETE');
    expect(list.items.findIndex((i) => i.libraryId === 'SYN-L007')).toBeLessThan(list.items.findIndex((i) => i.libraryId === 'SYN-L001'));
  });
});

describe('render', () => {
  it('uploads a new SVG named for the exact revision and sets Needs Review, never Approved', async () => {
    const item = await renderedL001();
    expect(item.version).toBe('SOAR-v1.1 / r01 / LinkedIn / en');
    expect(item.imageStatus).toBe('Needs Review');
    expect(item.approval).toBe('not_approved');
    expect(item.reviewable).toEqual({ ok: true });
    expect(drive.created).toHaveLength(1);
    expect(drive.created[0]!.name).toBe('SYN-L001-SOAR-v1.1-r01-LinkedIn-en.svg');
    expect(drive.created[0]!.mimeType).toBe('image/svg+xml');
    const c = await cells('SYN-L001');
    expect(c.imageFile).toMatch(/^https:\/\/drive\.google\.com\/file\/d\/SYNTH_[A-Za-z0-9_-]+\/view$/);
    expect(c.visualVersion).toBe('SOAR-v1.1 / r01 / LinkedIn / en');
    expect(c.imageNextAction).not.toMatch(/\[cs:visual:/);
    const bytes = new TextDecoder().decode(drive.bytesOf(drive.created[0]!.id));
    expect(bytes).toBe(renderBriefSvg(complete, { language: 'en', platform: 'LinkedIn', revision: 1 }).svg);
    expect(assetFileName('SYN-T001', { revision: 12, platform: 'Threads', language: 'zh-TW' })).toBe('SYN-T001-SOAR-v1.1-r12-Threads-zh-TW.svg');
  });

  it('a Drive upload failure writes nothing to the Sheet', async () => {
    ok(await decide('SYN-L001', 'original_graphic'));
    ok(await brief('SYN-L001', {}));
    const before = await cells('SYN-L001');
    drive.failNext({ op: 'write', code: 'PROVIDER_UNAVAILABLE' });
    expect(await render('SYN-L001')).toMatchObject({ ok: false, code: 'PROVIDER_UNAVAILABLE' });
    expect(await cells('SYN-L001')).toEqual(before);
  });

  it('a Sheet failure after upload is a partial failure, and the retry reuses the same upload', async () => {
    ok(await decide('SYN-L001', 'original_graphic'));
    ok(await brief('SYN-L001', {}));
    const v = await view('SYN-L001');
    const input = { operationId: 'op_render_retry_1', libraryId: 'SYN-L001', expectedRevision: v.revision };
    sheet.failNext({ op: 'write', tab: SHEET_TABS.library.name, code: 'PROVIDER_UNAVAILABLE' });
    expect(await renderRevision(repo, drive, owner, input)).toMatchObject({ ok: false, code: 'PARTIAL_FAILURE' });
    const retried = ok(await renderRevision(repo, drive, owner, input));
    expect(retried.version).toBe('SOAR-v1.1 / r01 / LinkedIn / en');
    expect(drive.created).toHaveLength(1);
    // A lost response on the retry replays rather than uploading again.
    const again = await renderRevision(repo, drive, owner, input);
    expect(again).toMatchObject({ ok: true, replayed: true });
    expect(drive.created).toHaveLength(1);
  });
});

describe('VIS-04: approval belongs to the exact revision', () => {
  it('approves the exact revision, then a brief edit makes it stale', async () => {
    const rendered = await renderedL001();
    const wrong = await approve('SYN-L001', { material: '00000000' });
    expect(wrong).toMatchObject({ ok: false, code: 'STALE_READ' });
    expect(await approve('SYN-L001', { version: 'SOAR-v1.1 / r02 / LinkedIn / en' })).toMatchObject({ ok: false, code: 'STALE_READ' });

    const approved = ok(await approve('SYN-L001'));
    expect(approved.approval).toBe('approved');
    expect(approved.imageStatus).toBe('Approved');
    expect(approved.gates.filter((g) => g.severity === 'hard')).toEqual([]);
    expect((await cells('SYN-L001')).imageNextAction).toMatch(/^Approved exact revision \[cs:visual:[0-9a-f]{8}\]$/);
    expect(approved.version).toBe(rendered.version);

    const edited = ok(await brief('SYN-L001', { lineBrokenCopy: 'One number invites a counter.\nA researched range\nproves you did the work.' }));
    expect(edited.approval).toBe('stale');
    expect(edited.gates.map((g) => g.code)).toContain('VISUAL_STALE');
    expect(edited.reviewable.ok).toBe(false);
    const record = await repo.getLibrary('SYN-L001');
    expect(evaluateLibraryGates(record.value, { purpose: 'ready' }).blockers.map((g) => g.code)).toContain('VISUAL_STALE');

    const r02 = ok(await render('SYN-L001'));
    expect(r02.version).toBe('SOAR-v1.1 / r02 / LinkedIn / en');
    expect(r02.approval).toBe('not_approved');
    expect(r02.imageStatus).toBe('Needs Review');
    expect(ok(await approve('SYN-L001')).approval).toBe('approved');
  });

  it('a replacement file or alt text change in the Sheet invalidates the approval', async () => {
    await renderedL001();
    ok(await approve('SYN-L001'));
    sheetEdit('SYN-L001', 'Image File', 'https://drive.google.com/file/d/SYNTH_asset_replacement_file/view');
    const replaced = await view('SYN-L001');
    expect(replaced.approval).toBe('stale');
    expect(replaced.gates.map((g) => g.code)).toContain('VISUAL_STALE');

    sheet = new FakeSheetTransport();
    repo = new SheetsContentRepository(sheet);
    await renderedL001();
    ok(await approve('SYN-L001'));
    sheetEdit('SYN-L001', 'Image Alt Text', 'Different alt text');
    expect((await view('SYN-L001')).approval).toBe('stale');
  });

  it('refuses when the Drive file no longer matches the brief render', async () => {
    const item = await renderedL001();
    const fileId = drive.created[0]!.id;
    drive.externalReplaceBytes(fileId, new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    const refused = await approve('SYN-L001');
    expect(refused).toMatchObject({ ok: false, code: 'GATE_BLOCKED' });
    expect(refused.ok ? '' : refused.message).toMatch(/does not match/);
    expect((await view('SYN-L001')).approval).toBe(item.approval);
  });

  it('refuses with a clear message when Image Next Action holds a formula', async () => {
    const rows = syntheticLibraryRows();
    const col = LIBRARY_ORDER.indexOf('imageNextAction');
    const row = rows.find((r) => r.values[0] === 'SYN-L001')!;
    const formulas = [...(row.formulas ?? row.values)];
    formulas[col] = '=IF(LEN(AC2)>0,"Review image","Assess visual need")';
    Object.assign(row, { formulas });
    sheet = new FakeSheetTransport({ [SHEET_TABS.library.name]: rows });
    repo = new SheetsContentRepository(sheet);
    const item = await renderedL001();
    expect(item.imageNextActionIsFormula).toBe(true);
    const refused = await approve('SYN-L001');
    expect(refused).toMatchObject({ ok: false, code: 'GATE_BLOCKED' });
    expect(refused.ok ? '' : refused.message).toMatch(/formula/);
    expect((await cells('SYN-L001')).imageStatus).toBe('Needs Review');
  });

  it('approving the same revision twice is a replay, not a second write', async () => {
    await renderedL001();
    ok(await approve('SYN-L001'));
    const writes = sheet.writes.length;
    expect(await approve('SYN-L001')).toMatchObject({ ok: true, replayed: true });
    expect(sheet.writes.length).toBe(writes);
  });

  it('viewers cannot decide, render or approve', async () => {
    const v = await view('SYN-L007');
    expect(await decideVisual(repo, viewer, { operationId: op(), libraryId: 'SYN-L007', expectedRevision: v.revision, decision: 'text_only' })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await renderRevision(repo, drive, viewer, { operationId: op(), libraryId: 'SYN-L007', expectedRevision: v.revision })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('a stale expected revision is refused with the current row', async () => {
    const v = await view('SYN-L007');
    sheetEdit('SYN-L007', 'Current Hook', 'Edited directly in the Sheet');
    const out = await decideVisual(repo, owner, { operationId: op(), libraryId: 'SYN-L007', expectedRevision: v.revision, decision: 'text_only' });
    expect(out).toMatchObject({ ok: false, code: 'STALE_READ' });
    expect(out.ok ? null : out.current?.libraryId).toBe('SYN-L007');
    expect((await cells('SYN-L007')).visualSource).toBe('Original graphic');
  });
});

describe('VIS-05: screenshot reuse across Library and Schedule', () => {
  it('SYN-L009 shows the same-platform reuse as a hard blocker', async () => {
    const l009 = await view('SYN-L009');
    expect(l009.reuse.state).toBe('same_platform');
    expect(l009.reuse.message).toMatch(/already used on LinkedIn/);
    expect(l009.gates.map((g) => g.code)).toContain('SCREENSHOT_REUSED');
    expect(l009.reviewable.ok).toBe(false);
  });

  it('blocks the same platform, allows another platform, and allows a fresh original graphic', async () => {
    const before = await cells('SYN-L001');
    const same = await decide('SYN-L001', { screenshotId: 'SHOT-2026-014' });
    expect(same).toMatchObject({ ok: false, code: 'GATE_BLOCKED', reuse: { state: 'same_platform' } });
    expect(await cells('SYN-L001')).toEqual(before);

    const other = ok(await decide('SYN-X004', { screenshotId: 'SHOT-2026-014' }));
    expect(other.reuse.state).toBe('other_platform');
    expect(other.imageStatus).toBe('Needs Review');
    expect((await cells('SYN-X004')).visualSource).toBe('SHOT-2026-014');

    const fresh = ok(await decide('SYN-L009', 'original_graphic'));
    expect(fresh.decision).toBe('original_graphic');
    expect(fresh.gates.map((g) => g.code)).not.toContain('SCREENSHOT_REUSED');
  });

  it('is uncertain, and blocks, when the Schedule cannot be read', async () => {
    const v = await view('SYN-X004');
    sheet.failNext({ op: 'read', tab: SHEET_TABS.schedule.name, code: 'PROVIDER_UNAVAILABLE' });
    const out = await decideVisual(repo, owner, { operationId: op(), libraryId: 'SYN-X004', expectedRevision: v.revision, decision: { screenshotId: 'SHOT-2026-020' } });
    expect(out).toMatchObject({ ok: false, code: 'GATE_BLOCKED', reuse: { state: 'uncertain' } });
    expect((await cells('SYN-X004')).visualSource).toBe('Text only');
  });

  it('the read-only check reports clear, other-platform and same-platform', async () => {
    expect(await checkScreenshot(repo, 'SYN-L001', 'SHOT-2026-999')).toMatchObject({ ok: true, reuse: { state: 'clear' } });
    expect(await checkScreenshot(repo, 'SYN-X004', 'SHOT-2026-014')).toMatchObject({ ok: true, reuse: { state: 'other_platform' } });
    expect(await checkScreenshot(repo, 'SYN-L001', 'SHOT-2026-014')).toMatchObject({ ok: true, reuse: { state: 'same_platform' } });
    expect(await checkScreenshot(repo, 'SYN-L001', 'x')).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });
});

describe('VIS-06: alt text, caveat and illustrative labels', () => {
  it('an illustrative reconstruction needs a caveat that says illustrative', async () => {
    ok(await decide('SYN-L001', 'original_graphic'));
    const missing = ok(await brief('SYN-L001', { illustrativeReconstruction: true, caveat: 'Based on a real email' }));
    expect(missing.imageStatus).toBe('Needs Brief');
    expect(missing.briefProblems.map((p) => p.field)).toContain('caveat');
    const labelled = ok(await brief('SYN-L001', { illustrativeReconstruction: true, caveat: 'Illustrative reconstruction, not a real offer.' }));
    expect(labelled.imageStatus).toBe('Brief Ready');
    const item = ok(await render('SYN-L001'));
    const svg = new TextDecoder().decode(drive.bytesOf(drive.created[0]!.id));
    expect(svg).toContain('>Illustrative reconstruction, not a real offer.</text>');
    expect(svg).toContain(`<title>${complete.altText}</title>`);
    expect((await cells('SYN-L001')).imageAltText).toBe(complete.altText);
    expect(item.reviewable.ok).toBe(true);
  });

  it('a screenshot without alt text cannot be approved', async () => {
    ok(await decide('SYN-X004', { screenshotId: 'SHOT-2026-099' }));
    const v = await view('SYN-X004');
    expect(v.reviewable).toEqual({ ok: false, reason: 'Write alt text for the screenshot first.' });
    expect(await approve('SYN-X004')).toMatchObject({ ok: false, code: 'GATE_BLOCKED' });
  });

  it('zh-TW is the language for Threads targets', async () => {
    sheetEdit('SYN-L007', 'Target Platform', 'Threads');
    const v = await view('SYN-L007');
    expect(v.language).toBe('zh-TW');
    const zh = {
      lineBrokenCopy: '只給一個數字\n會引來還價。\n給有研究的範圍。',
      focalPhrase: '有研究的範圍',
      mainIdeas: ['單一數字引來還價', '範圍代表你做過功課'],
      altText: '兩個方框比較單一薪資數字與有研究的薪資範圍。',
    };
    ok(await brief('SYN-L007', zh));
    const item = ok(await render('SYN-L007'));
    expect(item.version).toBe('SOAR-v1.1 / r01 / Threads / zh-TW');
    expect(drive.created[0]!.name).toBe('SYN-L007-SOAR-v1.1-r01-Threads-zh-TW.svg');
  });
});

describe('preview truthfulness', () => {
  it('stops previewing a revision once its brief changes, in the app or in the Sheet', async () => {
    const item = await renderedL001();
    expect(item.preview).toBe('current');
    expect((await cells('SYN-L001')).imageNextAction).toMatch(/\[cs:render:[0-9a-f]{8}\]$/);

    sheetEdit('SYN-L001', 'Image Brief', COMPLETE_BRIEF.replace('researched range', 'researched  range'));
    const changed = await view('SYN-L001');
    expect(changed.preview).toBe('changed');
    expect(changed.reviewable.ok).toBe(false);
    expect(await approve('SYN-L001')).toMatchObject({ ok: false, code: 'GATE_BLOCKED' });
  });

  it('a revision with no render stamp (made outside Content Studio) is not previewed or approvable here', async () => {
    ok(await decide('SYN-L001', 'original_graphic'));
    ok(await brief('SYN-L001', {}));
    sheetEdit('SYN-L001', 'Visual Version', 'SOAR-v1.1 / r05 / LinkedIn / en');
    sheetEdit('SYN-L001', 'Image File', 'https://drive.google.com/file/d/SYNTH_asset_manual_upload/view');
    sheetEdit('SYN-L001', 'Image Status', 'Needs Review');
    const v = await view('SYN-L001');
    expect(v.preview).toBe('changed');
    expect(v.reviewable.ok).toBe(false);
    expect(v.canRender).toEqual({ ok: true, nextVersion: 'SOAR-v1.1 / r06 / LinkedIn / en' });
  });
});
