import { describe, expect, it, vi } from 'vitest';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { FakeDriveGateway } from '@/integrations/google/fake-drive';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { loadEditor } from '@/application/editor';
import { SHEET_TABS } from '@/domain/sheet-schema';

/**
 * CS-051: an editor open must not read the whole Schedule tab unless the post
 * uses a screenshot (the only thing the Schedule is consulted for). Each tab page
 * is three Sheets API calls, and the extra read pushed production into Google's
 * per-minute quota.
 */
function setup() {
  const sheet = new FakeSheetTransport();
  const readTab = vi.spyOn(sheet, 'readTab');
  const repo = new SheetsContentRepository(sheet);
  const drive = new FakeDriveGateway();
  const scheduleReads = () => readTab.mock.calls.filter(([tab]) => tab === SHEET_TABS.schedule.name).length;
  return { repo, drive, scheduleReads };
}

describe('loadEditor Sheet reads (CS-051)', () => {
  it('does not read the Schedule tab for a text-only post', async () => {
    const { repo, drive, scheduleReads } = setup();
    const model = await loadEditor(repo, drive, 'SYN-L008');
    expect(model.visual).toBe('Text only');
    expect(scheduleReads()).toBe(0);
  });

  it('still reads the Schedule tab when the post uses a screenshot, so reuse is checked', async () => {
    const { repo, drive, scheduleReads } = setup();
    const model = await loadEditor(repo, drive, 'SYN-L009');
    expect(model.visual).not.toBe('Text only');
    expect(scheduleReads()).toBeGreaterThan(0);
  });
});
