import { describe, expect, it } from 'vitest';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { FakeDriveGateway } from '@/integrations/google/fake-drive';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { buildReconcileReport, type WeeklyBackupSignal } from '@/application/reconcile';
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
});
