import { describe, expect, it } from 'vitest';
import { buildSheetMirrorSnapshot, mirrorHash, type MirrorRow } from '@/application/sheet-mirror';
import { compareSheetMirror } from '@/application/sheet-mirror-parity';
import type { MutationEnvelope } from '@/domain/mutation';
import type { LibraryPatch } from '@/domain/mapping';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { SnapshotContentRepository } from '@/integrations/supabase/snapshot-content-repository';

const sourceKey = 'synthetic_workbook';
const runId = '33333333-3333-4333-8333-333333333333';

describe('MIG-03: read-only shadow parity', () => {
  it('reconstructs every repository read exactly, including source collection order', async () => {
    const sheets = new SheetsContentRepository(new FakeSheetTransport());
    const snapshot = await buildSheetMirrorSnapshot(sheets, { sourceKey, runId });
    // The stored/read order is not trusted; position is the source of truth.
    const mirror = new SnapshotContentRepository([...snapshot.rows].reverse());

    expect(mirror.capability()).toMatchObject({ provider: 'sheet', state: 'read_only' });
    expect(await mirror.schema()).toEqual(await sheets.schema());
    expect(await mirror.listLibrary()).toEqual(await sheets.listLibrary());
    expect(await mirror.listQueue()).toEqual(await sheets.listQueue());
    expect(await mirror.listReadyQueue()).toEqual(await sheets.listReadyQueue());
    expect(await mirror.listSchedule()).toEqual(await sheets.listSchedule());
    expect(await mirror.queueSummary()).toEqual(await sheets.queueSummary());
    expect(await mirror.workflowSettings()).toEqual(await sheets.workflowSettings());

    const library = (await sheets.listLibrary())[0]!;
    const queue = (await sheets.listQueue())[0]!;
    const schedule = (await sheets.listSchedule())[0]!;
    expect(await mirror.getLibrary(library.value.libraryId)).toEqual(library);
    expect(await mirror.getQueue(queue.value.libraryId)).toEqual(queue);
    expect(await mirror.getSchedule(schedule.value.contentId)).toEqual(schedule);
  });

  it('refuses all writes instead of creating a second authority', async () => {
    const sheets = new SheetsContentRepository(new FakeSheetTransport());
    const snapshot = await buildSheetMirrorSnapshot(sheets, { sourceKey, runId });
    const mirror = new SnapshotContentRepository(snapshot.rows);
    const record = (await mirror.listLibrary())[0]!;
    const mutation: MutationEnvelope<{ libraryId: string }, LibraryPatch> = {
      operationId: 'mirror-write-refused',
      actor: { sub: 'owner', role: 'owner' },
      target: { libraryId: record.value.libraryId },
      expectedRevision: record.revision,
      patch: { pesto: 'P' },
    };
    await expect(mirror.updateLibrary(mutation)).resolves.toMatchObject({ ok: false, code: 'CONFIG_MISSING' });
    await expect(mirror.updateQueue(mutation)).resolves.toMatchObject({ ok: false, code: 'CONFIG_MISSING' });
    await expect(
      mirror.updateSchedule({ ...mutation, target: { contentId: 'SYN-C001' }, patch: { content: 'never written' } }),
    ).resolves.toMatchObject({ ok: false, code: 'CONFIG_MISSING' });
  });

  it('reports exact parity without exposing stable IDs or content', async () => {
    const sheets = new SheetsContentRepository(new FakeSheetTransport());
    const snapshot = await buildSheetMirrorSnapshot(sheets, { sourceKey, runId });
    expect(compareSheetMirror(snapshot, snapshot.rows)).toEqual({
      exact: true,
      sourceSnapshotHash: snapshot.snapshotHash,
      expectedRows: snapshot.rows.length,
      activeRows: snapshot.rows.length,
      mismatches: [],
    });

    const changedSource = snapshot.rows.find((row) => row.collection === 'library')!;
    const missingSource = snapshot.rows.find((row) => row.collection === 'schedule')!;
    const active = snapshot.rows
      .filter((row) => row !== missingSource)
      .map((row) => (row === changedSource ? { ...row, rowHash: mirrorHash({ changed: true }), payload: { privateCopy: 'do not return' } } : row));
    const unexpected: MirrorRow = {
      collection: 'library',
      stableId: 'PRIVATE-UNEXPECTED-ID',
      position: 999,
      sourceRow: 999,
      sourceRevision: 'private-revision',
      rowHash: mirrorHash({ privateCopy: 'hidden' }),
      payload: { privateCopy: 'hidden' },
    };
    const report = compareSheetMirror(snapshot, [...active, unexpected]);
    expect(report.exact).toBe(false);
    expect(report.mismatches.map(({ kind }) => kind).sort()).toEqual(['changed', 'missing', 'unexpected']);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(changedSource.stableId);
    expect(serialized).not.toContain(missingSource.stableId);
    expect(serialized).not.toContain(unexpected.stableId);
    expect(serialized).not.toContain('do not return');
    expect(serialized).not.toContain('private-revision');
  });

  it('rejects order, source metadata, duplicate rows and payload drift even when row hashes claim a match', async () => {
    const snapshot = await buildSheetMirrorSnapshot(new SheetsContentRepository(new FakeSheetTransport()), { sourceKey, runId });
    const original = snapshot.rows.find((row) => row.collection === 'library')!;
    const replacements: MirrorRow[] = [
      { ...original, position: original.position + 1 },
      { ...original, sourceRow: (original.sourceRow ?? 0) + 1 },
      { ...original, sourceRevision: 'a different private revision' },
      { ...original, payload: { forged: 'private text' } },
    ];
    for (const replacement of replacements) {
      const active = snapshot.rows.map((row) => row === original ? replacement : row);
      const report = compareSheetMirror(snapshot, active);
      expect(report.exact).toBe(false);
      expect(report.mismatches).toEqual([{ collection: 'library', kind: 'changed', fingerprint: expect.any(String) }]);
      expect(JSON.stringify(report)).not.toContain(original.stableId);
      expect(JSON.stringify(report)).not.toContain('private');
    }
    const duplicate = compareSheetMirror(snapshot, [...snapshot.rows, original]);
    expect(duplicate.exact).toBe(false);
    expect(duplicate.activeRows).toBe(snapshot.rows.length + 1);
    expect(duplicate.mismatches).toEqual([{ collection: 'library', kind: 'changed', fingerprint: expect.any(String) }]);
  });

  it('fails closed on duplicate source positions or malformed singleton payloads', async () => {
    const snapshot = await buildSheetMirrorSnapshot(new SheetsContentRepository(new FakeSheetTransport()), { sourceKey, runId });
    const library = snapshot.rows.filter((row) => row.collection === 'library');
    expect(() => new SnapshotContentRepository([library[0]!, { ...library[1]!, position: library[0]!.position }])).toThrowError(/provider is unavailable/i);

    const malformed = snapshot.rows.map((row) => (row.collection === 'schema' ? { ...row, payload: null } : row));
    await expect(new SnapshotContentRepository(malformed).schema()).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
});
