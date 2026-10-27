import { expect, it, vi } from 'vitest';
import { readBacklogSources } from '@/application/backlog-sources';
import { backlogReadiness } from '@/application/backlog-readiness';
import { databaseOnlyRepository } from '@/application/database-only';
import { FakeContentDb } from '@/integrations/supabase/fake-content-db';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';

it('DB backlog derives Ready candidates from the Library snapshot without another full-body query', async () => {
  const db = new FakeContentDb();
  const list = vi.spyOn(db, 'listPosts');
  const repo = databaseOnlyRepository(new SupabaseContentRepository(db), true);
  const [library, queue, schedule] = await readBacklogSources(repo);
  expect(list.mock.calls).toEqual([['library']]);
  expect(queue).toEqual(await new SupabaseContentRepository(db).listReadyQueue());
  expect(backlogReadiness(library, queue, schedule)).toEqual(backlogReadiness(library, await repo.listReadyQueue(), schedule));
});
