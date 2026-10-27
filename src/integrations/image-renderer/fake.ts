import 'server-only';
import { createHash } from 'node:crypto';
import { rendererBriefSchema, type ImageRenderer, type RendererBrief, type RenderedImage } from './port';

/** A real tiny PNG for deterministic UI/Drive tests; no network. */
export class FakeImageRenderer implements ImageRenderer {
  readonly calls: RendererBrief[] = [];
  async render(input: RendererBrief): Promise<RenderedImage> {
    const brief = rendererBriefSchema.parse(input);
    this.calls.push(brief);
    const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=', 'base64'));
    return { png, sidecar: { sha256: createHash('sha256').update(png).digest('hex'), tool_version: 'SOAR-clean-editorial-v2.4.1 / fake', resolved_copy: brief } };
  }
}
