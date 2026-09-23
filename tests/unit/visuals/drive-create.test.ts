import { beforeAll, describe, expect, it } from 'vitest';
import { exportPKCS8, generateKeyPair } from 'jose';
import { ServiceAccountTokens } from '@/integrations/google/service-account';
import { GoogleDriveGateway } from '@/integrations/google/google-drive';
import { FakeDriveGateway } from '@/integrations/google/fake-drive';

/**
 * DriveGateway.createFile contract (CS-012): fake and Google adapters, with a
 * scripted fetch for Google. No network; synthetic ids only.
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
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
const FOLDER = 'SYNTH_asset_folder_0001';

describe('FakeDriveGateway.createFile', () => {
  it('stores the bytes as a new file and returns a Drive-style link', async () => {
    const drive = new FakeDriveGateway();
    const a = await drive.createFile({ name: 'SYN-L001-SOAR-v1.1-r01-LinkedIn-en.svg', mimeType: 'image/svg+xml', bytes: svg });
    const b = await drive.createFile({ name: 'SYN-L001-SOAR-v1.1-r01-LinkedIn-en.svg', mimeType: 'image/svg+xml', bytes: svg });
    expect(a.id).not.toBe(b.id);
    expect(a.webLink).toBe(`https://drive.google.com/file/d/${a.id}/view`);
    expect(a.id.startsWith('SYNTH_')).toBe(true);
    expect(a.mimeType).toBe('image/svg+xml');
    expect(a.size).toBe(svg.length);
    expect((await drive.readBytes(a.id, 1000)).bytes).toEqual(svg);
  });

  it('refuses unsafe names and empty files, and can fail on demand', async () => {
    const drive = new FakeDriveGateway();
    await expect(drive.createFile({ name: '../x.svg', mimeType: 'image/svg+xml', bytes: svg })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(drive.createFile({ name: 'x.svg', mimeType: 'image/svg+xml', bytes: new Uint8Array() })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    drive.failNext({ op: 'write', code: 'RATE_LIMITED' });
    await expect(drive.createFile({ name: 'x.svg', mimeType: 'image/svg+xml', bytes: svg })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(drive.created).toHaveLength(0);
  });
});

describe('GoogleDriveGateway.createFile', () => {
  it('uploads multipart into the configured asset folder and builds the link from the id', async () => {
    const { impl, calls } = scripted([
      tokenOk,
      () =>
        new Response(
          JSON.stringify({ id: 'SYNTH_created_file_0001', mimeType: 'image/svg+xml', modifiedTime: '2026-09-23T00:00:00Z', version: '1', size: String(svg.length), webViewLink: 'https://evil.example.com/' }),
          { status: 200 },
        ),
    ]);
    const drive = new GoogleDriveGateway(new ServiceAccountTokens('svc@example.com', pem, impl), true, impl, FOLDER);
    const out = await drive.createFile({ name: 'SYN-L001-SOAR-v1.1-r01-LinkedIn-en.svg', mimeType: 'image/svg+xml', bytes: svg });
    expect(out.webLink).toBe('https://drive.google.com/file/d/SYNTH_created_file_0001/view');
    expect(out.revision).toBe('1');

    const upload = calls[1]!;
    expect(upload.url).toMatch(/^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?uploadType=multipart&supportsAllDrives=true/);
    expect(upload.init?.method).toBe('POST');
    const headers = upload.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer synthetic-access-token');
    const boundary = /^multipart\/related; boundary=(\S+)$/.exec(headers['content-type']!)?.[1];
    expect(boundary).toBeTruthy();
    const body = new TextDecoder().decode(upload.init?.body as Uint8Array);
    expect(body).toContain(`--${boundary}\r\ncontent-type: application/json; charset=utf-8\r\n\r\n`);
    const meta = JSON.parse(body.split('\r\n\r\n')[1]!.split('\r\n')[0]!) as { name: string; mimeType: string; parents: string[] };
    expect(meta).toEqual({ name: 'SYN-L001-SOAR-v1.1-r01-LinkedIn-en.svg', mimeType: 'image/svg+xml', parents: [FOLDER] });
    expect(body).toContain(`content-type: image/svg+xml\r\n\r\n<svg xmlns="http://www.w3.org/2000/svg"/>\r\n--${boundary}--\r\n`);
  });

  it('is CONFIG_MISSING when writes are disabled or no asset folder is configured, without calling Google', async () => {
    const { impl, calls } = scripted([]);
    const tokens = new ServiceAccountTokens('svc@example.com', pem, impl);
    await expect(new GoogleDriveGateway(tokens, false, impl, FOLDER).createFile({ name: 'a.svg', mimeType: 'image/svg+xml', bytes: svg })).rejects.toMatchObject({
      code: 'CONFIG_MISSING',
    });
    await expect(new GoogleDriveGateway(tokens, true, impl).createFile({ name: 'a.svg', mimeType: 'image/svg+xml', bytes: svg })).rejects.toMatchObject({ code: 'CONFIG_MISSING' });
    expect(calls).toHaveLength(0);
  });

  it('maps provider refusals to typed errors and is not retried', async () => {
    const { impl, calls } = scripted([tokenOk, () => new Response('{}', { status: 403 })]);
    const drive = new GoogleDriveGateway(new ServiceAccountTokens('svc@example.com', pem, impl), true, impl, FOLDER);
    await expect(drive.createFile({ name: 'a.svg', mimeType: 'image/svg+xml', bytes: svg })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(calls).toHaveLength(2);
  });

  it('refuses a bad file name before any request', async () => {
    const { impl, calls } = scripted([]);
    const drive = new GoogleDriveGateway(new ServiceAccountTokens('svc@example.com', pem, impl), true, impl, FOLDER);
    await expect(drive.createFile({ name: 'a/b.svg', mimeType: 'image/svg+xml', bytes: svg })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(calls).toHaveLength(0);
  });
});
