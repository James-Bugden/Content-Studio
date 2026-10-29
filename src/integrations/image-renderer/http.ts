import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '@/domain/errors';
import { rendererBriefSchema, type ImageRenderer, type RendererBrief, type RenderedImage } from './port';

const responseSchema = z.object({ png: z.string().min(1).max(5_600_000), sidecar: z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/), tool_version: z.string().max(200), resolved_copy: rendererBriefSchema,
}).passthrough() });
/** Key-order independent JSON, so the echoed brief is compared by content, not by byte layout. */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => Array.isArray(v) ? v.map(walk)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, walk(x)]))
      : v;
  return JSON.stringify(walk(value));
}
const briefHash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
/** Client wait for the render. The Python function (vercel.json) must allow at least this long. */
export const RENDER_TIMEOUT_MS = 110_000;
export class ImageRenderError extends AppError {
  constructor(readonly label: string) { super('VALIDATION_FAILED'); }
}
export class HttpImageRenderer implements ImageRenderer {
  constructor(private readonly url: string, private readonly secret: string, private readonly http: typeof fetch = fetch) {}
  async render(brief: RendererBrief): Promise<RenderedImage> {
    if (!this.secret || !this.url) throw new AppError('CONFIG_MISSING');
    const parsed = rendererBriefSchema.safeParse(brief);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED');
    const response = await this.http(this.url, { method: 'POST', redirect: 'error', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Image-Renderer-Secret': this.secret },
      body: JSON.stringify({ brief: parsed.data }), signal: AbortSignal.timeout(RENDER_TIMEOUT_MS) });
    if (response.status === 422) {
      const error = await response.json().catch(() => null);
      // Python returns a field path, never copy, credentials or arbitrary provider text.
      const label = typeof error?.label === 'string' && /^[A-Za-z0-9_.[\] -]{1,120}$/.test(error.label) ? error.label : 'brief';
      throw new ImageRenderError(label);
    }
    if (!response.ok) throw new AppError('PROVIDER_UNAVAILABLE');
    const raw = await response.text();
    if (raw.length > 6_000_000) throw new AppError('PROVIDER_UNAVAILABLE');
    let data: z.infer<typeof responseSchema>;
    try { data = responseSchema.parse(JSON.parse(raw)); } catch { throw new AppError('PROVIDER_UNAVAILABLE'); }
    const png = new Uint8Array(Buffer.from(data.png, 'base64'));
    if (png.length > 4_000_000 || Buffer.from(png.subarray(0, 8)).toString('hex') !== '89504e470d0a1a0a'
      || createHash('sha256').update(png).digest('hex') !== data.sidecar.sha256
      || briefHash(data.sidecar.resolved_copy) !== briefHash(parsed.data)) throw new AppError('PROVIDER_UNAVAILABLE');
    return { png, sidecar: data.sidecar };
  }
}
