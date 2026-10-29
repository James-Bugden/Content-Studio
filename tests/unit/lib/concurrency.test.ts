import { describe, expect, it } from 'vitest';
import { mapLimit, mapLimitSettled, TimeoutError, withTimeout } from '@/lib/concurrency';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('mapLimit (CS #250)', () => {
  it('never runs more than the limit at once and keeps input order', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([30, 5, 20, 1, 10, 2, 8], 3, async (ms, i) => {
      active++;
      peak = Math.max(peak, active);
      await sleep(ms);
      active--;
      return `${i}:${ms}`;
    });
    expect(peak).toBe(3);
    expect(out).toEqual(['0:30', '1:5', '2:20', '3:1', '4:10', '5:2', '6:8']);
  });

  it('runs N items in about ceil(N/limit) rounds, not serially', async () => {
    const started = Date.now();
    await mapLimit(Array.from({ length: 10 }, (_, i) => i), 5, () => sleep(60));
    expect(Date.now() - started).toBeLessThan(10 * 60 * 0.6);
  });

  it('handles empty input and non-positive limits', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
    expect(await mapLimit([1, 2], 0, async (n) => n * 2)).toEqual([2, 4]);
  });

  it('partial failure: settled keeps every outcome in order; mapLimit rejects with the first failure after all finished', async () => {
    const seen: number[] = [];
    const fn = async (n: number) => {
      await sleep(5);
      seen.push(n);
      if (n === 1 || n === 3) throw new Error(`bad ${n}`);
      return n;
    };
    const settled = await mapLimitSettled([0, 1, 2, 3, 4], 2, fn);
    expect(settled.map((s) => s.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'rejected', 'fulfilled']);
    expect(settled[4]).toEqual({ status: 'fulfilled', value: 4 });
    seen.length = 0;
    await expect(mapLimit([0, 1, 2, 3, 4], 2, fn)).rejects.toThrow('bad 1');
    expect(seen.sort()).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('withTimeout', () => {
  it('resolves and rejects like the underlying work when it is fast enough', async () => {
    await expect(withTimeout(async () => 'ok', 100)).resolves.toBe('ok');
    await expect(withTimeout(Promise.reject(new Error('boom')), 100)).rejects.toThrow('boom');
    await expect(withTimeout((() => { throw new Error('sync boom'); }) as () => Promise<never>, 100)).rejects.toThrow('sync boom');
  });

  it('rejects with TimeoutError when work is too slow', async () => {
    const error = (await withTimeout(sleep(200), 20).catch((e: unknown) => e)) as TimeoutError;
    expect(error).toBeInstanceOf(TimeoutError);
    expect(error.ms).toBe(20);
  });

  it('a timed-out item fails alone inside mapLimitSettled', async () => {
    const settled = await mapLimitSettled([5, 300, 5], 3, (ms) => withTimeout(sleep(ms).then(() => ms), 40));
    expect(settled.map((s) => s.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect((settled[1] as PromiseRejectedResult).reason).toBeInstanceOf(TimeoutError);
  });
});
