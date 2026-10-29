import { describe, expect, it, vi } from 'vitest';
import { collapseFailures, runCombinedAiCheck, toPartResult, type PartResult } from '@/components/editor/combined-ai-check';

const ok = (body: unknown) => ({ status: 200, body });

describe('combined AI check runner (#247)', () => {
  it('runs all three parts in parallel and reports each as it finishes', async () => {
    const urls: string[] = [];
    const post = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.endsWith('/qa')) return ok({ ok: true, proposal: { id: 'q', draftHash: 'h', summary: '', findings: [] } });
      if (url.endsWith('/hooks')) return ok({ ok: true, proposal: { alternatives: [1, 2, 3, 4].map((n) => ({ text: `h${n}` })) } });
      return ok({ ok: true, verdict: 'no_image', reason: 'r' });
    });
    const seen: PartResult[] = [];
    const out = await runCombinedAiCheck({ libraryId: 'A/B', draft: 'd', draftHash: 'h', signal: new AbortController().signal, onPart: (r) => seen.push(r), post });
    expect(urls.sort()).toEqual(['/api/library/A%2FB/hooks', '/api/library/A%2FB/image-need', '/api/library/A%2FB/qa']);
    expect(seen).toHaveLength(3);
    const hooks = out.find((r) => r.part === 'hooks')!;
    expect(hooks.ok && hooks.part === 'hooks' && hooks.alternatives).toHaveLength(3);
  });

  it('turns a failing or throwing part into a failure without hiding the others', async () => {
    const post = vi.fn(async (url: string) => {
      if (url.endsWith('/qa')) throw new Error('boom');
      if (url.endsWith('/hooks')) return { status: 401, body: { ok: false, code: 'AUTH_REQUIRED' } };
      return ok({ ok: true, verdict: 'needs_image', reason: 'r' });
    });
    const out = await runCombinedAiCheck({ libraryId: 'L', draft: 'd', draftHash: 'h', signal: new AbortController().signal, onPart: () => {}, post });
    expect(out.find((r) => r.part === 'qa')).toMatchObject({ ok: false, code: 'PROVIDER_UNAVAILABLE' });
    expect(out.find((r) => r.part === 'hooks')).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
    expect(out.find((r) => r.part === 'image')).toMatchObject({ ok: true });
  });

  it('rethrows an abort and reports nothing after it', async () => {
    const ctrl = new AbortController();
    const post = vi.fn(async () => { ctrl.abort(); throw Object.assign(new Error('x'), { name: 'AbortError' }); });
    const onPart = vi.fn();
    await expect(runCombinedAiCheck({ libraryId: 'L', draft: 'd', draftHash: 'h', signal: ctrl.signal, onPart, post })).rejects.toThrow();
    expect(onPart).not.toHaveBeenCalled();
  });

  it('collapses repeated cap refusals into one and keeps other failures', () => {
    expect(collapseFailures([
      { part: 'qa', code: 'AI_LIMIT_REACHED' }, { part: 'hooks', code: 'PROVIDER_UNAVAILABLE' }, { part: 'image', code: 'AI_LIMIT_REACHED' },
    ])).toEqual([{ part: 'qa', code: 'AI_LIMIT_REACHED' }, { part: 'hooks', code: 'PROVIDER_UNAVAILABLE' }]);
  });

  it('passes up to three sketch options through with the image verdict, and none for no image', () => {
    const option = (n: number) => ({ title: `T${n}`, reason: 'r', layout: 'steps', sketch: 'x' });
    const four = [1, 2, 3, 4].map(option);
    expect(toPartResult('image', ok({ ok: true, verdict: 'needs_image', reason: 'r', options: four }))).toMatchObject({ ok: true, image: { verdict: 'needs_image', options: four.slice(0, 3) } });
    expect(toPartResult('image', ok({ ok: true, verdict: 'needs_image', reason: 'r', options: [option(1)] }))).toMatchObject({ image: { options: [option(1)] } });
    expect(toPartResult('image', ok({ ok: true, verdict: 'no_image', reason: 'r', options: four }))).toMatchObject({ image: { options: [] } });
    expect(toPartResult('image', ok({ ok: true, verdict: 'needs_image', reason: 'r' }))).toMatchObject({ image: { options: [] } });
  });

  it('keeps the image check a single request even with options', async () => {
    const urls: string[] = [];
    const post = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.endsWith('/qa')) return ok({ ok: true, proposal: { id: 'q', draftHash: 'h', summary: '', findings: [] } });
      if (url.endsWith('/hooks')) return ok({ ok: true, proposal: { alternatives: [] } });
      return ok({ ok: true, verdict: 'needs_image', reason: 'r', options: [{ title: 'T', reason: 'r', layout: 'steps', sketch: 'x' }] });
    });
    await runCombinedAiCheck({ libraryId: 'L', draft: 'd', draftHash: 'h', signal: new AbortController().signal, onPart: () => {}, post });
    expect(urls.filter((u) => u.endsWith('/image-need'))).toHaveLength(1);
    expect(urls).toHaveLength(3);
  });

  it('maps unknown error codes safely', () => {
    expect(toPartResult('qa', { status: 500, body: { ok: false, code: 'NOPE' } })).toMatchObject({ ok: false, code: 'UNKNOWN' });
  });
});
