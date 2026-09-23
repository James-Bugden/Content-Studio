/**
 * Browser-side helpers for calling the app's own API (client code only).
 *
 * Every mutation carries an operation id so a retry after a lost response is
 * recognised as the same operation rather than applied twice. Responses are
 * typed JSON; network failures become a typed PROVIDER_UNAVAILABLE result so the
 * UI never mistakes "no answer" for "success".
 */
export type ApiResult<T> = { status: number; body: T };

export function newOperationId(prefix = 'op'): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2);
  return `${prefix}_${random}`.slice(0, 80);
}

export async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<ApiResult<T | { ok: false; code: 'PROVIDER_UNAVAILABLE'; message: string }>> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      ...(signal ? { signal } : {}),
    });
    const json = (await res.json().catch(() => null)) as T | null;
    if (json === null) return { status: res.status, body: { ok: false, code: 'PROVIDER_UNAVAILABLE', message: 'The server did not answer clearly. Nothing is confirmed as saved.' } };
    return { status: res.status, body: json };
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') throw error;
    return { status: 0, body: { ok: false, code: 'PROVIDER_UNAVAILABLE', message: 'No connection. Nothing is confirmed as saved; your text is kept here.' } };
  }
}

export async function getJson<T>(url: string): Promise<ApiResult<T | { ok: false; code: 'PROVIDER_UNAVAILABLE'; message: string }>> {
  try {
    const res = await fetch(url, { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    const json = (await res.json().catch(() => null)) as T | null;
    if (json === null) return { status: res.status, body: { ok: false, code: 'PROVIDER_UNAVAILABLE', message: 'The server did not answer clearly.' } };
    return { status: res.status, body: json };
  } catch {
    return { status: 0, body: { ok: false, code: 'PROVIDER_UNAVAILABLE', message: 'No connection. Nothing was changed.' } };
  }
}
