import 'server-only';
import { mirrorHash, type MirrorCollection, type MirrorRow, type SheetMirrorSnapshot } from './sheet-mirror';

export type ParityMismatch = {
  collection: MirrorCollection;
  kind: 'missing' | 'unexpected' | 'changed';
  fingerprint: string;
};

export type SheetMirrorParityReport = {
  exact: boolean;
  sourceSnapshotHash: string;
  expectedRows: number;
  activeRows: number;
  mismatches: ParityMismatch[];
};

function key(row: MirrorRow): string {
  return `${row.collection}\u0000${row.stableId}`;
}

function fingerprint(row: MirrorRow): string {
  return mirrorHash({ collection: row.collection, stableId: row.stableId }).slice(0, 16);
}

/** Compare content hashes without returning content, revisions, row numbers or IDs. */
export function compareSheetMirror(snapshot: SheetMirrorSnapshot, active: MirrorRow[]): SheetMirrorParityReport {
  const expected = new Map(snapshot.rows.map((row) => [key(row), row]));
  const actual = new Map(active.map((row) => [key(row), row]));
  const mismatches: ParityMismatch[] = [];

  for (const [id, row] of expected) {
    const mirrored = actual.get(id);
    if (!mirrored) mismatches.push({ collection: row.collection, kind: 'missing', fingerprint: fingerprint(row) });
    else if (mirrored.rowHash !== row.rowHash) mismatches.push({ collection: row.collection, kind: 'changed', fingerprint: fingerprint(row) });
  }
  for (const [id, row] of actual) {
    if (!expected.has(id)) mismatches.push({ collection: row.collection, kind: 'unexpected', fingerprint: fingerprint(row) });
  }
  mismatches.sort((a, b) => a.collection.localeCompare(b.collection) || a.kind.localeCompare(b.kind) || a.fingerprint.localeCompare(b.fingerprint));

  return {
    exact: mismatches.length === 0,
    sourceSnapshotHash: snapshot.snapshotHash,
    expectedRows: snapshot.rows.length,
    activeRows: active.length,
    mismatches,
  };
}
