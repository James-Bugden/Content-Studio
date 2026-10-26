import { expect, it } from 'vitest';
import { ownerCutoverResult } from '@/application/cutover-result';
import { verifiedCutoverResult } from '@/domain/cutover';
import { cutoverBuild } from '../../fixtures/cutover';

const hash = 'b'.repeat(64), counts = { library:1, queue:0, schedule:0, workflow_settings:0 };
it('owner export returns fixed aggregate verdicts without private IDs, fields, source text or comparison diagnostics', () => {
  const result = ownerCutoverResult('export', { exact:false, dbHash:hash, sheetHash:hash, counts,
    differences:[{id:'SYNTHETIC_PRIVATE_ID', fields:['SYNTHETIC_PRIVATE_HEADER'], copy:'SYNTHETIC_PRIVATE_COPY'}],
    comparison:{private:'SYNTHETIC_PRIVATE_REFERENCE'} },cutoverBuild);
  expect(result).toEqual({exact:false,dbHash:hash,sheetHash:hash,counts,differences:[{reason:'export_mismatch'}]});
  expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE'); expect(verifiedCutoverResult('export',result,cutoverBuild)).toBe(false);
});
it('owner measure strips unknown nested fields and receipts require complete real green measurements', () => {
  const samples=Object.fromEntries(['library','queue','ready','schedule','queue_summary','workflow_settings'].map(collection=>[collection,
    {collection,idsEqual:true,blocking:0,fields:1000,equal:1000,lagMs:0,facts:[{private:'SYNTHETIC_PRIVATE_COPY'}]}]));
  const result=ownerCutoverResult('measure',{coverage:'all-rows',build:cutoverBuild,samples,secret:'SYNTHETIC_PRIVATE_SECRET'},cutoverBuild);
  expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE'); expect(verifiedCutoverResult('measure',result,cutoverBuild)).toBe(true);
  for(const patch of [{idsEqual:false},{blocking:1},{equal:998},{equal:1001},{lagMs:null},{lagMs:900001}]) {
    expect(verifiedCutoverResult('measure',{...result,samples:{...samples,library:{...samples.library,...patch}}},cutoverBuild)).toBe(false);
  }
  delete samples.ready; expect(verifiedCutoverResult('measure',{...result,samples},cutoverBuild)).toBe(false);
});
it('never verifies mismatched builds, false waivers, unknown actions or unequal parity hashes', () => {
  expect(verifiedCutoverResult('activate-db',{mode:'db',build:'c'.repeat(40),contract:'schema-2:cutover-1'},cutoverBuild)).toBe(false);
  expect(verifiedCutoverResult('backup',{status:'backup_waived',waiver:{audited:false,build:cutoverBuild,auditHash:hash}},cutoverBuild)).toBe(false);
  expect(verifiedCutoverResult('backup',{status:'verified'},cutoverBuild)).toBe(false);
  expect(verifiedCutoverResult('export',{exact:true,dbHash:hash,sheetHash:'c'.repeat(64),counts,differences:[]},cutoverBuild)).toBe(false);
});
