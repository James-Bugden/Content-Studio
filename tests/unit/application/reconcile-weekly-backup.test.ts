import { describe, expect, it } from 'vitest';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { FakeDriveGateway } from '@/integrations/google/fake-drive';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { buildReconcileReport, startReconcile, type WeeklyBackupSignal } from '@/application/reconcile';
import { fixIssuesCount } from '@/application/navigation-counts';

const NOW = Date.parse('2026-10-05T00:00:00+08:00');
const report = (weeklyBackup?: WeeklyBackupSignal) => buildReconcileReport(new SheetsContentRepository(new FakeSheetTransport()), new FakeDriveGateway(), NOW, weeklyBackup ? { weeklyBackup } : {});

describe('weekly backup in the Fix issues report', () => {
  it('adds no item when the backup is healthy', async () => {
    expect((await report()).items.some(i => i.kind === 'weekly_backup')).toBe(false);
  });
  it('a stale or failed backup is a blocking item, so it raises the Fix issues count', async () => {
    const base = await report();
    const withWarning = await report({ kind: 'warning', level: 'stale', message: 'The last successful backup is 9 days old (limit 8). Press Back up now.' });
    const item = withWarning.items.find(i => i.kind === 'weekly_backup')!;
    expect(item).toMatchObject({ severity: 'blocking', title: 'Weekly backup needs attention' });
    expect(item.facts[0]).toContain('9 days old');
    expect(fixIssuesCount(withWarning)).toBe(fixIssuesCount(base)! + 1);
  });
  it('an unset folder or unreadable history is shown, but does not raise the count', async () => {
    const base = await report();
    for (const signal of [{ kind: 'not_configured' }, { kind: 'unavailable' }] as const) {
      const r = await report(signal);
      expect(r.items.find(i => i.kind === 'weekly_backup')).toMatchObject({ severity: 'attention' });
      expect(fixIssuesCount(r)).toBe(fixIssuesCount(base));
    }
  });
  it('accepts the signal as a promise, and a rejected read becomes a quiet unavailable item', async () => {
    const repo = new SheetsContentRepository(new FakeSheetTransport());
    const ok = await buildReconcileReport(repo, new FakeDriveGateway(), NOW, { weeklyBackup: Promise.resolve({ kind: 'warning', level: 'failed', message: 'Last backup failed.' }) });
    expect(ok.items.find(i => i.kind === 'weekly_backup')).toMatchObject({ severity: 'blocking' });
    const bad = await buildReconcileReport(repo, new FakeDriveGateway(), NOW, { weeklyBackup: Promise.reject(new Error('db down')) });
    expect(bad.items.find(i => i.kind === 'weekly_backup')).toMatchObject({ severity: 'attention', title: 'Backup status could not be read' });
  });
  it('the fast part carries the backup item without waiting for Drive or Typefully', async () => {
    const start = startReconcile(new SheetsContentRepository(new FakeSheetTransport()), new FakeDriveGateway(), NOW, { weeklyBackup: { kind: 'warning', level: 'stale', message: 'Old.' } });
    expect((await start.fast).items.some(i => i.kind === 'weekly_backup')).toBe(true);
    await start.report;
  });
});
