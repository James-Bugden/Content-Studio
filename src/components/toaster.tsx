'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { TONES, type ResultTone } from './inline-result';

/**
 * Transient confirmations (CS-006).
 *
 * One polite live region, present from first paint so screen readers register it
 * before any message arrives. Toasts are for "done" news only; anything that needs
 * a decision or explains a failure belongs in an InlineResult or StateView next to
 * the thing it concerns, because toasts disappear. Messages must be content-free.
 */
type ToastAction = { label: string; run: () => Promise<void>; durationMs?: number };
type Toast = { id: number; tone: ResultTone; message: string; action?: ToastAction; busy?: boolean };
type ToastApi = { notify: (message: string, tone?: ResultTone) => void; notifyAction: (message: string, action: ToastAction) => void };

const ToastContext = createContext<ToastApi | null>(null);
const TOAST_MS = 6000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const notify = useCallback(
    (message: string, tone: ResultTone = 'success') => {
      const id = nextId.current++;
      setToasts((all) => [...all.slice(-2), { id, tone, message }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TOAST_MS),
      );
    },
    [dismiss],
  );
  const notifyAction = useCallback((message: string, action: ToastAction) => {
    const id = nextId.current++;
    setToasts(all => [...all, { id, tone: 'success', message, action }]);
    timers.current.set(id, setTimeout(() => dismiss(id), action.durationMs ?? 12_000));
  }, [dismiss]);

  async function runAction(toast: Toast) {
    if (!toast.action || toast.busy) return;
    const timer = timers.current.get(toast.id);
    if (timer) clearTimeout(timer);
    setToasts(all => all.map(t => t.id === toast.id ? { ...t, busy: true } : t));
    try { await toast.action.run(); dismiss(toast.id); }
    catch { setToasts(all => all.map(t => t.id === toast.id ? { ...t, action: { ...toast.action!, label: 'Retry Undo' }, busy: false, tone: 'error', message: 'Restore was not confirmed. Retry Undo or reload to check its state.' } : t)); }
  }

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
    };
  }, []);

  const api = useMemo(() => ({ notify, notifyAction }), [notify, notifyAction]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-label="Notifications"
        className="pointer-events-none fixed right-4 bottom-20 left-4 z-40 md:bottom-4 flex flex-col items-end gap-2 sm:left-auto sm:w-96"
      >
        {toasts.map((toast) => {
          const t = TONES[toast.tone];
          return (
            <div key={toast.id} className={`pointer-events-auto flex w-full items-start gap-3 rounded-md border px-4 py-3 shadow-md ${t.box}`}>
              <span aria-hidden="true" className="font-semibold">
                {t.glyph}
              </span>
              <p className="min-w-0 flex-1 text-sm">
                <span className="font-semibold">{t.label}: </span>
                {toast.message}
              </p>
              {toast.action ? <button type="button" disabled={toast.busy} onClick={() => void runAction(toast)} className="-my-2 min-h-11 px-2 text-sm font-semibold underline">{toast.busy ? 'Restoring…' : toast.action.label}</button> : null}
              <button type="button" onClick={() => dismiss(toast.id)} className="-my-1 rounded px-2 py-1 text-sm underline">
                Dismiss
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside ToastProvider (AppShell provides one).');
  return api;
}
