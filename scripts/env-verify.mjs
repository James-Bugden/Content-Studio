#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { manifest } from './env-setup.mjs';

export function compareHealth(health) {
  if (!health || health.ok !== true || !Array.isArray(health.capabilities)) throw new Error('Invalid health response');
  const rows = Object.entries(manifest.capabilities).map(([name, spec]) => {
    const matches = health.capabilities.filter(c => c?.provider === (spec.provider ?? name));
    const cap = matches[0];
    const state = spec.reported === false ? 'unreported' : matches.length > 1 ? 'error' : cap?.state ?? (spec.absent ? 'not_configured' : 'error');
    const valid = spec.reported === false || (spec.expected.includes(state) && (!cap || cap.mode === 'live'));
    return { capability: name, required: spec.required ? 'yes' : 'no', expected: spec.reported === false ? 'unreported' : spec.expected.join('/'), state: ['ready','read_only','not_configured','unreported'].includes(state) ? state : 'error', result: valid ? (spec.reported === false ? 'unverified' : 'pass') : 'fail' };
  });
  return { rows, code: health.mode !== 'live' || rows.some(r => r.result === 'fail') ? 1 : 0 };
}

export async function verify({ baseUrl = process.env.APP_BASE_URL, fetcher = fetch, log = console.log } = {}) {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    const response = await fetcher(new URL('/api/health', url), { redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error();
    const result = compareHealth(await response.json());
    log('capability | required | expected | state | result');
    for (const row of result.rows) log(Object.values(row).join(' | '));
    if (result.code) log('Production capability check failed; confirm live mode and required configuration, then redeploy.');
    return result.code;
  } catch {
    log('Health verification error. Set APP_BASE_URL to the HTTPS production origin; check deployment availability. Response/error bodies suppressed.');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await verify();
