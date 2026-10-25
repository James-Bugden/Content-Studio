import { expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error dependency-free Node CLI
import { privateStore } from '../../scripts/cutover.mjs';
const sid='S-1-5-21-111-222-333-1001';
const identity=`"synthetic-owner","${sid}"`;

it.each(['synthetic-other:(F)','CUSTOM\\Editors:(RX)',`${sid}:(F)\nsynthetic-other:(RX)`,'','unparseable ACL','synthetic-owner:(I)(F)','synthetic-owner:(DENY)(F)'])('refuses every unverified or nonowner Windows ACL: %s',async acl=>{
  const root=mkdtempSync(join(tmpdir(),'cs-cutover-acl-'));
  const run=vi.fn().mockResolvedValueOnce({ok:true,stdout:identity}).mockResolvedValueOnce({ok:true}).mockResolvedValueOnce({ok:true,stdout:acl});
  const store=privateStore(root,run,'win32');
  try { await expect(store.open()).rejects.toThrow(); }
  finally { store.close();rmSync(root,{recursive:true,force:true}); }
});

it('refuses unparsable Windows owner identity rather than accepting a bare SID',async()=>{
  const root=mkdtempSync(join(tmpdir(),'cs-cutover-acl-'));
  const run=vi.fn().mockResolvedValueOnce({ok:true,stdout:sid}).mockResolvedValueOnce({ok:true}).mockResolvedValueOnce({ok:true,stdout:'synthetic-owner:(F)'});
  const store=privateStore(root,run,'win32');
  try { await expect(store.open()).rejects.toThrow(); }
  finally { store.close();rmSync(root,{recursive:true,force:true}); }
});

it.each(['account','SID'])('accepts only verified owner %s ACEs, with native icacls path/summary',async principal=>{
  const root=mkdtempSync(join(tmpdir(),'cs-cutover-acl-'));
  const run=vi.fn().mockResolvedValueOnce({ok:true,stdout:identity}).mockResolvedValueOnce({ok:true}).mockResolvedValueOnce({ok:true,stdout:`${root} ${principal==='SID'?sid:'synthetic-owner'}:(OI)(CI)(F)\n\nSuccessfully processed 1 files; Failed processing 0 files`});
  const store=privateStore(root,run,'win32');
  try { await expect(store.open()).resolves.toBeUndefined(); }
  finally { store.close();rmSync(root,{recursive:true,force:true}); }
});
import { writeFileSync } from 'node:fs';
it.each(['state.json','run-11111111-1111-4111-8111-111111111111.json'])('refuses pre-existing private file ACL grants on %s',async name=>{
  const root=mkdtempSync(join(tmpdir(),'cs-cutover-acl-'));writeFileSync(join(root,name),'{}');
  const run=vi.fn().mockResolvedValueOnce({ok:true,stdout:identity}).mockResolvedValueOnce({ok:true}).mockResolvedValueOnce({ok:true,stdout:'synthetic-owner:(F)'}).mockResolvedValue({ok:true,stdout:'synthetic-other:(F)'});
  const store=privateStore(root,run,'win32');
  try { await expect(store.open()).rejects.toThrow(); }
  finally { store.close();rmSync(root,{recursive:true,force:true}); }
});
it('accepts protected files inheriting only the verified owner ACL',async()=>{
  const root=mkdtempSync(join(tmpdir(),'cs-cutover-acl-'));writeFileSync(join(root,'state.json'),'{}');
  const run=vi.fn().mockResolvedValueOnce({ok:true,stdout:identity}).mockResolvedValueOnce({ok:true}).mockResolvedValueOnce({ok:true,stdout:'synthetic-owner:(F)'}).mockResolvedValue({ok:true,stdout:'synthetic-owner:(I)(F)'});
  const store=privateStore(root,run,'win32');
  try { await store.open();expect(store.read()).toEqual({}); }
  finally { store.close();rmSync(root,{recursive:true,force:true}); }
});
it('refuses unexpected entries in the private Windows state folder',async()=>{
  const root=mkdtempSync(join(tmpdir(),'cs-cutover-acl-'));writeFileSync(join(root,'unexpected.json'),'{}');
  const run=vi.fn().mockResolvedValueOnce({ok:true,stdout:identity}).mockResolvedValueOnce({ok:true}).mockResolvedValue({ok:true,stdout:'synthetic-owner:(F)'});
  const store=privateStore(root,run,'win32');
  try { await expect(store.open()).rejects.toThrow('Unexpected'); }
  finally { store.close();rmSync(root,{recursive:true,force:true}); }
});
