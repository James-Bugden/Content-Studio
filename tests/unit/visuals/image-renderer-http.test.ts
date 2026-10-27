import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, expect, it } from 'vitest';
import { HttpImageRenderer } from '@/integrations/image-renderer/http';
import { FakeImageRenderer } from '@/integrations/image-renderer/fake';
import type { RendererBrief } from '@/integrations/image-renderer/port';

const brief: RendererBrief = { format: 'E03', title: 'A simple task', fields: { steps: ['Name task', 'Show evidence'] }, alt_text: 'Two connected steps.', platform: 'linkedin', language: 'en' };
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); });
async function server(reply: (input: unknown, headers: Record<string, unknown>) => Promise<{ status: number; data: unknown }>) {
  const http = createServer(async (req, res) => {
    let input = '';
    for await (const chunk of req) input += chunk;
    const result = await reply(JSON.parse(input), req.headers);
    res.writeHead(result.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(result.data));
  }).listen(0, '127.0.0.1');
  servers.push(http); await once(http, 'listening');
  return `http://127.0.0.1:${(http.address() as { port: number }).port}`;
}
it('production adapter sends a private header and validates PNG/sidecar from a fake HTTP server', async () => {
  const fake = await new FakeImageRenderer().render(brief);
  const url = await server(async (input, headers) => {
    expect(input).toEqual({ brief }); expect(headers['x-image-renderer-secret']).toBe('synthetic-render-secret');
    return { status: 200, data: { png: Buffer.from(fake.png).toString('base64'), sidecar: fake.sidecar } };
  });
  expect(await new HttpImageRenderer(url, 'synthetic-render-secret').render(brief)).toEqual(fake);
});
it('fails closed if the secret is missing', async () => {
  await expect(new HttpImageRenderer('http://127.0.0.1:1', '').render(brief)).rejects.toMatchObject({ code: 'CONFIG_MISSING' });
});
it('returns safe field errors, rejects corrupt bytes, wrong sidecars and unavailable functions', async () => {
  const fake = await new FakeImageRenderer().render(brief);
  for (const response of [
    { status: 422, data: { label: 'fields.steps[0]' } }, { status: 503, data: {} },
    { status: 200, data: { png: 'garbage', sidecar: fake.sidecar } },
    { status: 200, data: { png: Buffer.from(fake.png).toString('base64'), sidecar: { ...fake.sidecar, resolved_copy: { ...brief, title: 'Wrong brief' } } } },
  ]) {
    const url = await server(async () => response);
    await expect(new HttpImageRenderer(url, 'synthetic-render-secret').render(brief)).rejects.toMatchObject({ code: response.status === 422 ? 'VALIDATION_FAILED' : 'PROVIDER_UNAVAILABLE' });
  }
});
