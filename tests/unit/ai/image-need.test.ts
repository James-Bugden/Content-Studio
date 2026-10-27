import { beforeEach, describe, expect, it } from 'vitest';
import { FakeAiGateway } from '@/integrations/ai/fake-gateway';
import { runImageNeed } from '@/application/image-need';
import { fingerprint } from '@/domain/hash';

let ai: FakeAiGateway;
beforeEach(() => {
  ai = new FakeAiGateway();
});

const run = (draft: string, hash = fingerprint(draft)) => runImageNeed({ ai, libraryId: 'SYN-L001', draft, draftHash: hash, platform: 'LinkedIn' });

describe('image-need check (#242)', () => {
  it('says a structured post needs an image, with a one-line reason', async () => {
    const r = await run('Three steps:\n1. Ask\n2. Wait\n3. Counter');
    expect(r).toMatchObject({ ok: true, verdict: 'needs_image' });
    expect(r.ok && r.reason.length).toBeGreaterThan(0);
  });

  it('says a plain story needs no image', async () => {
    expect(await run('I once negotiated the scope first, and it worked.')).toMatchObject({ ok: true, verdict: 'no_image' });
  });

  it('wraps the draft as untrusted data and never calls the model for a stale or empty draft', async () => {
    await run('Plain draft');
    expect(ai.requests.at(-1)!.messages[0]!.content).toContain('<source_text>');
    const before = ai.requests.length;
    expect(await run('Plain draft', 'wrong-hash')).toMatchObject({ ok: false, code: 'STALE_READ' });
    expect(await run('   ')).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(ai.requests).toHaveLength(before);
  });

  it('reports a provider failure without a verdict', async () => {
    ai.failNext('PROVIDER_UNAVAILABLE');
    expect(await run('Plain draft')).toMatchObject({ ok: false, code: 'PROVIDER_UNAVAILABLE' });
  });
});
