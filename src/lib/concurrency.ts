import 'server-only';
/**
 * Small bounded-concurrency helpers for provider reads (CS #250).
 * Server-side only; pure and unit-testable.
 */
export class TimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`Timed out after ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

/** Reject with TimeoutError when `work` has not settled within `ms`. The timer is always cleared. */
export function withTimeout<T>(work: Promise<T> | (() => Promise<T>), ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    let promise: Promise<T>;
    try {
      promise = typeof work === 'function' ? work() : work;
    } catch (error) {
      clearTimeout(timer);
      reject(error);
      return;
    }
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * Run `fn` over `items` with at most `limit` calls in flight. Results keep the
 * input order. One failure never cancels the others: every outcome is returned.
 */
export async function mapLimitSettled<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(Math.floor(limit) || 1, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: 'fulfilled', value: await fn(items[index]!, index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/** Like mapLimitSettled, but rejects with the first (by input order) failure once all calls have finished. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const settled = await mapLimitSettled(items, limit, fn);
  const failed = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) throw failed.reason;
  return settled.map((r) => (r as PromiseFulfilledResult<R>).value);
}
