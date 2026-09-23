import { beforeAll, describe, expect, it } from 'vitest';
import { exportPKCS8, generateKeyPair } from 'jose';
import { ServiceAccountTokens, SCOPES, withReadRetry } from '@/integrations/google/service-account';
import { GoogleSheetTransport } from '@/integrations/google/google-sheet';
import { GoogleDriveGateway } from '@/integrations/google/google-drive';
import { AppError } from '@/domain/errors';

/**
 * Contract tests for the live Google adapters against a scripted fetch. No
 * network: every request is captured and answered synthetically.
 */
type Call = { url: string; init?: RequestInit };
let pem: string;

beforeAll(async () => {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  pem = await exportPKCS8(privateKey);
});

function scripted(responses: ((call: Call) => Response)[]) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request ${call.url}`);
    return next(call);
  }) as typeof fetch;
  return { impl, calls };
}

const tokenOk = () => new Response(JSON.stringify({ access_token: 'synthetic-access-token', expires_in: 3600 }), { status: 200 });
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('service account tokens', () => {
  it('requests a JWT-bearer token and caches it per scope set', async () => {
    const { impl, calls } = scripted([tokenOk]);
    const tokens = new ServiceAccountTokens('svc@example.com', pem, impl);
    expect(await tokens.token([SCOPES.sheetsRead])).toBe('synthetic-access-token');
    expect(await tokens.token([SCOPES.sheetsRead])).toBe('synthetic-access-token');
    expect(calls).toHaveLength(1);
    const body = String(calls[0]!.init?.body);
    expect(body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
  });

  it('an unreadable key is CONFIG_MISSING without echoing the key', async () => {
    const tokens = new ServiceAccountTokens('svc@example.com', 'not-a-key-CS_SENTINEL', scripted([]).impl);
    await expect(tokens.token([SCOPES.sheetsRead])).rejects.toMatchObject({ code: 'CONFIG_MISSING' });
    await expect(tokens.token([SCOPES.sheetsRead])).rejects.not.toThrow(/CS_SENTINEL/);
  });

  it('token refusal maps to typed errors', async () => {
    const tokens = new ServiceAccountTokens('svc@example.com', pem, scripted([() => jsonRes({ error: 'invalid_grant' }, 400)]).impl);
    await expect(tokens.token([SCOPES.sheetsRead])).rejects.toMatchObject({ code: 'CONFIG_MISSING' });
  });
});

describe('GoogleSheetTransport', () => {
  it('reads a quoted, bounded range with values, formulas and links', async () => {
    const { impl, calls } = scripted([
      tokenOk,
      () => jsonRes({ values: [['Library ID', 'State'], ['SYN-1', 'Editing']] }),
      () => jsonRes({ values: [['Library ID', 'State'], ['SYN-1', '=A1']] }),
      () => jsonRes({ sheets: [{ data: [{ rowData: [{ values: [{}, {}] }, { values: [{ hyperlink: 'https://drive.google.com/file/d/SYNTH_x_abcdefghijklmnop/view' }] }] }] }] }),
    ]);
    const t = new GoogleSheetTransport('SYNTH_sheet_id_0000000000', new ServiceAccountTokens('svc@example.com', pem, impl), false, impl);
    const rows = await t.readTab("James's Library", 'AG', { startRow: 1, maxRows: 500, formulas: true, links: true });
    expect(decodeURIComponent(calls[1]!.url)).toContain("'James''s Library'!A1:AG500");
    expect(calls[1]!.url).toContain('valueRenderOption=FORMATTED_VALUE');
    expect(calls[2]!.url).toContain('valueRenderOption=FORMULA');
    expect(rows[1]).toEqual({ values: ['SYN-1', 'Editing'], formulas: ['SYN-1', '=A1'], links: ['https://drive.google.com/file/d/SYNTH_x_abcdefghijklmnop/view'] });
  });

  it('writes named cells with RAW input so = is stored as text', async () => {
    const { impl, calls } = scripted([tokenOk, () => jsonRes({})]);
    const t = new GoogleSheetTransport('SYNTH_sheet_id_0000000000', new ServiceAccountTokens('svc@example.com', pem, impl), true, impl);
    await t.writeCells('Content Library', [{ row: 7, column: 25, value: '=IMPORTXML("x")' }, { row: 7, column: 10, value: true }]);
    const body = JSON.parse(String(calls[1]!.init?.body)) as { valueInputOption: string; data: { range: string; values: unknown[][] }[] };
    expect(body.valueInputOption).toBe('RAW');
    expect(body.data.map((d) => d.range)).toEqual(["'Content Library'!Z7", "'Content Library'!K7"]);
    expect(body.data[1]!.values).toEqual([[true]]);
  });

  it('refuses writes when write scope is not enabled', async () => {
    const t = new GoogleSheetTransport('SYNTH_sheet_id_0000000000', new ServiceAccountTokens('svc@example.com', pem, scripted([]).impl), false, scripted([]).impl);
    await expect(t.writeCells('Content Library', [{ row: 2, column: 1, value: 'x' }])).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it.each([
    [429, 'RATE_LIMITED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [503, 'PROVIDER_UNAVAILABLE'],
  ])('HTTP %s maps to %s after bounded retries for reads', async (status, code) => {
    const responses = [tokenOk, ...Array.from({ length: 3 }, () => () => new Response('{"error":"CS_SENTINEL_BODY"}', { status }))];
    const { impl } = scripted(responses);
    const t = new GoogleSheetTransport('SYNTH_sheet_id_0000000000', new ServiceAccountTokens('svc@example.com', pem, impl), false, impl);
    const err = await t.readTab('Content Library', 'AG', { startRow: 1, maxRows: 10, formulas: false, links: false }).catch((e: unknown) => e as AppError);
    expect(err).toMatchObject({ code });
    expect(JSON.stringify(err)).not.toContain('CS_SENTINEL_BODY');
  });
});

describe('withReadRetry', () => {
  it('retries only rate limits and provider outages', async () => {
    let n = 0;
    await expect(
      withReadRetry(
        async () => {
          n += 1;
          throw new AppError('FORBIDDEN');
        },
        3,
        async () => {},
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(n).toBe(1);
  });
});

describe('GoogleDriveGateway', () => {
  const meta = (version: string, extra: Record<string, unknown> = {}) => jsonRes({ id: 'SYNTH_md_abcdefghijklmnop', mimeType: 'text/markdown', modifiedTime: '2026-09-23T00:00:00Z', version, size: '12', ...extra });

  it('writeText refuses when the revision moved', async () => {
    const { impl } = scripted([tokenOk, () => meta('8')]);
    const d = new GoogleDriveGateway(new ServiceAccountTokens('svc@example.com', pem, impl), true, impl);
    await expect(d.writeText('SYNTH_md_abcdefghijklmnop', 'x', '7')).rejects.toMatchObject({ code: 'STALE_READ' });
  });

  it('writeText uploads media only after the revision check', async () => {
    const { impl, calls } = scripted([tokenOk, () => meta('7'), () => meta('8')]);
    const d = new GoogleDriveGateway(new ServiceAccountTokens('svc@example.com', pem, impl), true, impl);
    const m = await d.writeText('SYNTH_md_abcdefghijklmnop', '談 🙂', '7');
    expect(m.revision).toBe('8');
    expect(calls[2]!.init?.method).toBe('PATCH');
    expect(calls[2]!.url).toContain('uploadType=media');
    expect(calls[2]!.init?.body).toBe('談 🙂');
  });

  it('rejects malformed file ids before any request', async () => {
    const { impl, calls } = scripted([]);
    const d = new GoogleDriveGateway(new ServiceAccountTokens('svc@example.com', pem, impl), true, impl);
    await expect(d.getMeta('../../etc/passwd')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(calls).toHaveLength(0);
  });

  it('refuses non-text files for readText', async () => {
    const { impl } = scripted([tokenOk, () => meta('3', { mimeType: 'application/pdf' })]);
    const d = new GoogleDriveGateway(new ServiceAccountTokens('svc@example.com', pem, impl), false, impl);
    await expect(d.readText('SYNTH_md_abcdefghijklmnop')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
