import { expect, it } from 'vitest';
import { backlogListRow } from '@/domain/library-backlog';
import { FakeContentDb } from '@/integrations/supabase/fake-content-db';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';

it('projects only inventory fields, bounding copy and excluding raw/provider/editor data', async () => {
  const record = (await new SupabaseContentRepository(new FakeContentDb()).listLibrary())[0]!;
  record.value.draftContent = '漢🙂'.repeat(16000) + 'FULL_BODY_TAIL';
  record.value.hookAlternatives = 'alternative '.repeat(5000);
  record.cells.draftContent = record.value.draftContent;
  record.passthrough = { large: 'private import metadata' };
  const row = backlogListRow(record);
  expect(row.value.draftContent.length).toBeLessThanOrEqual(220);
  expect(row.value.hookAlternatives.length).toBeLessThanOrEqual(1200);
  expect(Object.keys(row).sort()).toEqual(['revision', 'row', 'value']);
  expect(Object.keys(row.value).sort()).toEqual(['contentSource', 'currentHook', 'draftContent', 'hookAlternatives', 'hookTemplate', 'libraryId', 'pesto', 'queueForSchedule', 'reviewStatus', 'slug', 'state', 'targetPlatform']);
  expect(JSON.stringify(row)).not.toMatch(/FULL_BODY_TAIL|private import|sourceMarkdown|visual|cells/);
  expect(record.value.draftContent).toContain('FULL_BODY_TAIL');
  expect(row.revision).toBe(record.revision);
});
