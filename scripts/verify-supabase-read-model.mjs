#!/usr/bin/env node
/**
 * Live MIG-04 denial probe. Uses only the project's public anon key and an
 * invalid, non-mutating RPC header. Values and response bodies are never logged.
 */
const url = (process.env.SUPABASE_READ_MODEL_URL ?? '').replace(/\/$/, '');
const anonKey = process.env.SUPABASE_READ_MODEL_TEST_ANON_KEY ?? '';
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) || anonKey.length < 20) {
  console.error('supabase denial probe: set SUPABASE_READ_MODEL_URL and SUPABASE_READ_MODEL_TEST_ANON_KEY');
  process.exit(2);
}

const probes = [
  {
    name: 'anonymous table read',
    path: '/rest/v1/content_studio_sheet_rows?select=stable_id&limit=1',
    init: { method: 'GET' },
  },
  {
    name: 'anonymous snapshot RPC',
    path: '/rest/v1/rpc/begin_content_studio_sheet_snapshot',
    init: {
      method: 'POST',
      body: JSON.stringify({ p_schema_version: 0, p_source_key: 'denial_probe', p_run_id: '00000000-0000-4000-8000-000000000000', p_started_at: '2000-01-01T00:00:00.000Z', p_snapshot_hash: '0'.repeat(64), p_counts: {} }),
    },
  },
];

let failed = false;
for (const probe of probes) {
  let response;
  try {
    response = await fetch(`${url}${probe.path}`, {
      ...probe.init,
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    console.error(`${probe.name}: network failure`);
    failed = true;
    continue;
  }
  const denied = response.status === 401 || response.status === 403;
  console.log(`${probe.name}: ${denied ? 'denied' : `UNSAFE status ${response.status}`}`);
  if (!denied) failed = true;
}

if (failed) process.exit(1);
console.log('supabase denial probe: clean');
