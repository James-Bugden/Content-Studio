import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { SupabaseAiUsageRepository } from '@/integrations/supabase/ai-usage-repository';
import { AiUsageService } from '@/application/ai-usage';

let pg: PGlite;
let repo: SupabaseAiUsageRepository;
const actorHash = 'a'.repeat(64);
const reservation = () => ({ id: randomUUID(), feature: 'hooks' as const, model: 'claude-opus-5', inputTokens: 100, outputTokens: 100, costMicros: 3000 });
beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;');
  const migration = readFileSync('supabase/migrations/20261027000300_ai_usage.sql', 'utf8');
  await pg.exec(migration); await pg.exec(migration); // Reapplication must be safe.
  repo = new SupabaseAiUsageRepository({ url: 'http://localhost:54321', serviceKey: 'synthetic-service-role-key-only', fetch: async (_url, init) => {
    const { p_action, p_data } = JSON.parse(String(init?.body));
    try {
      const result = await pg.transaction(async tx => {
        await tx.exec('set local role service_role');
        return (await tx.query<{ result: unknown }>('select content_studio_ai_usage($1,$2) result', [p_action, p_data])).rows[0]!.result;
      });
      return Response.json(result);
    } catch (error) { return Response.json({ code: (error as { code: string }).code }, { status: 400 }); }
  } });
});
beforeEach(async () => { await pg.exec('truncate content_studio_ai_calls, content_studio_ai_cap_operations; update content_studio_ai_budget set cap_micros=20000000, version=1;'); });
afterAll(async () => { await pg?.close(); });

it('PostgREST adapter and real SQL reserve, settle exactly once and reject conflicting repeats', async () => {
  expect(await repo.summary()).toMatchObject({ spentMicros: 0, capMicros: 20_000_000, version: 1, calls: [] });
  const call = reservation(); await repo.begin(call);
  await expect(repo.begin(call)).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await repo.summary()).toMatchObject({ spentMicros: 3000, calls: [{ id: call.id, status: 'pending', feature: 'hooks' }] });
  const { feature: _feature, ...settlement } = call;
  await repo.finish({ ...settlement, costMicros: 30, inputTokens: 1, outputTokens: 1, status: 'completed' });
  await repo.finish({ ...settlement, costMicros: 30, inputTokens: 1, outputTokens: 1, status: 'completed' });
  expect((await repo.summary()).spentMicros).toBe(30);
  await expect(repo.finish({ ...settlement, status: 'completed' })).rejects.toMatchObject({ code: 'CONFLICT' });
});
it.each([20_000_000, 20_000_001])('SQL blocks at and above cap (%s) before any provider call', async costMicros => {
  await repo.begin({ ...reservation(), costMicros });
  let called = false;
  await expect(new AiUsageService(repo).track('hooks', 'claude-opus-5', 1, 1,
    async () => { called = true; return {}; }, () => ({ model: 'claude-opus-5' }))).rejects.toMatchObject({ code: 'AI_LIMIT_REACHED' });
  expect(called).toBe(false);
});
it('SQL counts pending reservations, carries a saved cap into the new month and excludes previous months', async () => {
  const change = { operationId: randomUUID(), expectedVersion: 1, capMicros: 3000, actorHash };
  await repo.setCap(change); await repo.setCap(change);
  await repo.begin(reservation());
  await expect(repo.begin(reservation())).rejects.toMatchObject({ code: 'AI_LIMIT_REACHED' });
  await pg.exec("update content_studio_ai_calls set timestamp=(date_trunc('month',now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei')-interval '1 second'");
  expect(await repo.summary()).toMatchObject({ spentMicros: 0, capMicros: 3000, version: 2 });
  await repo.begin(reservation());
  expect((await repo.summary()).calls).toHaveLength(2);
  await expect(repo.setCap({ ...change, capMicros: 0 })).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(repo.setCap({ ...change, operationId: randomUUID() })).rejects.toMatchObject({ code: 'STALE_READ' });
  expect((await pg.query('select * from content_studio_ai_cap_operations')).rows).toHaveLength(1);
});
it('zero cap pauses calls and concurrent admissions share one durable check', async () => {
  await repo.setCap({ operationId: randomUUID(), expectedVersion: 1, capMicros: 0, actorHash });
  await expect(repo.begin(reservation())).rejects.toMatchObject({ code: 'AI_LIMIT_REACHED' });
  await repo.setCap({ operationId: randomUUID(), expectedVersion: 2, capMicros: 3000, actorHash });
  const results = await Promise.allSettled([repo.begin(reservation()), repo.begin(reservation())]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect((await repo.summary()).calls).toHaveLength(1);
});
it('RLS is enabled and neither public role can read/write tables or execute the RPC', async () => {
  const tables = ['content_studio_ai_budget', 'content_studio_ai_calls', 'content_studio_ai_cap_operations'];
  for (const table of tables) {
    expect((await pg.query<{ relrowsecurity: boolean }>('select relrowsecurity from pg_class where relname=$1', [table])).rows[0]!.relrowsecurity).toBe(true);
    for (const role of ['anon', 'authenticated']) {
      await expect(pg.transaction(async tx => { await tx.exec(`set local role ${role}`); await tx.query(`select * from ${table}`); })).rejects.toThrow(/permission denied/);
      await expect(pg.transaction(async tx => { await tx.exec(`set local role ${role}`); await tx.query("select content_studio_ai_usage('summary')"); })).rejects.toThrow(/permission denied/);
    }
  }
});
it('SQL limits recent calls to 25 while the monthly total includes the whole ledger', async () => {
  for (let i = 0; i < 27; i++) await repo.begin(reservation());
  const summary = await repo.summary();
  expect(summary.calls).toHaveLength(25); expect(summary.spentMicros).toBe(81_000);
});
it('SQL rejects incomplete cap CAS and null settlement replays instead of returning a false success', async () => {
  const call = reservation(); await repo.begin(call);
  const { feature: _feature, ...settlement } = call;
  await repo.finish({ ...settlement, status: 'completed' });
  await expect(pg.query('select content_studio_ai_usage($1,$2)', ['finish', { ...settlement, status: 'completed', inputTokens: null }])).rejects.toMatchObject({ code: '22023' });
  await expect(pg.query('select content_studio_ai_usage($1,$2)', ['set_cap', { operationId: randomUUID(), capMicros: 0, actorHash }])).rejects.toMatchObject({ code: '22023' });
  expect((await repo.summary()).spentMicros).toBe(3000);
});
