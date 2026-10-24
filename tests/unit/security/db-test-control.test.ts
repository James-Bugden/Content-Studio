import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/test-control/route';
import { getServices, resetServices } from '@/application/container';
import { resetEnvCache } from '@/lib/env';

const post = (data: object) => POST(new Request('http://localhost/api/test-control', { method: 'POST', body: JSON.stringify(data) }));
beforeEach(() => {
  vi.stubEnv('CS_DATA_MODE','fake'); vi.stubEnv('CS_CONTENT_STORE','db'); vi.stubEnv('CS_TEST_MODE','e2e'); vi.stubEnv('VERCEL_ENV','preview');
  resetEnvCache(); resetServices();
});
afterEach(() => { vi.unstubAllEnvs(); resetEnvCache(); resetServices(); });

describe('DB e2e control boundary', () => {
  it.each([{CS_DATA_MODE:'live',CS_CONTENT_STORE:'sheet'},{CS_TEST_MODE:'unit'},{VERCEL_ENV:'production',CS_DATA_MODE:'live',CS_CONTENT_STORE:'sheet'}])('is absent outside synthetic e2e mode: %j', async env => {
    for (const [key,value] of Object.entries(env)) vi.stubEnv(key,value);
    resetEnvCache();
    expect((await post({kind:'db_fail_next',op:'write',code:'PROVIDER_UNAVAILABLE'})).status).toBe(404);
  });
  it('injects a write failure once and an external edit changes the revision', async () => {
    const {repo} = getServices(); const before = await repo.getLibrary('SYN-L001');
    expect((await post({kind:'db_fail_next',op:'write',code:'PROVIDER_UNAVAILABLE'})).status).toBe(200);
    const m = {operationId:'synthetic_control_fault',actor:{sub:'synthetic-owner',role:'owner' as const},target:{libraryId:'SYN-L001'},expectedRevision:before.revision,patch:{draftContent:'Synthetic'}};
    expect(await repo.updateLibrary(m)).toMatchObject({ok:false,code:'PROVIDER_UNAVAILABLE'});
    expect((await repo.updateLibrary(m)).ok).toBe(true);
    expect((await post({kind:'db_external_edit',collection:'library',id:'SYN-L001',patch:{draftContent:'External'}})).status).toBe(200);
    const after = await repo.getLibrary('SYN-L001'); expect(after.cells.draftContent).toBe('External'); expect(after.revision).not.toBe(before.revision);
    expect((await post({kind:'db_external_edit',collection:'library',id:'SYN-MISSING',patch:{draftContent:'External'}})).status).toBe(404);
    expect((await post({kind:'db_external_edit',collection:'library',id:'SYN-L001',patch:{row_version:'100'}})).status).toBe(400);
  });
});
