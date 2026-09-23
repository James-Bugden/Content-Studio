import { afterEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/lib/env';

/**
 * OBS-01: health output carries commit and capability states only. Every
 * configured value below is a synthetic sentinel; none may appear in the body.
 */
const SENTINELS = {
  AUTH_SECRET: `CS_SECRET_SENTINEL_${'AUTH0001'}${'x'.repeat(30)}`,
  AUTH_GOOGLE_ID: 'CS_SENTINEL_google_client_id',
  AUTH_GOOGLE_SECRET: 'CS_SENTINEL_google_client_secret',
  CS_OWNER_GOOGLE_SUB: '100000000000000000001',
  CS_OWNER_EMAIL: 'owner@example.com',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'svc@example.com',
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: 'CS_SENTINEL_private_key_material',
  CS_SHEET_ID: 'SYNTH_sheet_id_sentinel_0000000',
  TYPEFULLY_API_KEY: 'CS_SENTINEL_typefully',
  TYPEFULLY_SOCIAL_SET_ID: 'CS_SENTINEL_social_set',
};

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
});

async function health() {
  const { GET } = await import('@/app/api/health/route');
  const res = await GET();
  return { res, text: await res.text() };
}

describe('OBS-01 health output', () => {
  it('OBS-01 / SEC-08: reports read-only capabilities without leaking any configured value', async () => {
    const env = process.env as Record<string, string | undefined>;
    delete env.AI_API_KEY;
    Object.assign(process.env, SENTINELS, { CS_DATA_MODE: 'live', GOOGLE_WRITE_ENABLED: 'false' });
    resetEnvCache();
    const { res, text } = await health();
    expect(res.headers.get('cache-control')).toContain('no-store');
    for (const value of Object.values(SENTINELS)) expect(text).not.toContain(value);
    const body = JSON.parse(text) as { capabilities: { provider: string; state: string }[] };
    expect(body.capabilities.find((c) => c.provider === 'sheet')?.state).toBe('read_only');
    expect(body.capabilities.find((c) => c.provider === 'typefully')?.state).toBe('ready');
  });

  it('refuses fake mode in production', async () => {
    Object.assign(process.env, { CS_DATA_MODE: 'fake', VERCEL_ENV: 'production' });
    resetEnvCache();
    await expect(health()).rejects.toThrow(/refused in production/);
  });
});
