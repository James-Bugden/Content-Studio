'use client';

import { createContext, useContext, useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

const StatusTarget = createContext<RefObject<HTMLDivElement | null> | null>(null);

/** A shared presentation slot only. Provider state still comes from existing reads. */
export function ShellStatusProvider({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  // Attaching the slot must not update the provider around a streaming page:
  // that can force a client render before hydration and leave duplicate server
  // markup behind. Only the individual banners need to update after mounting.
  const target = useRef<HTMLDivElement>(null);
  return <StatusTarget value={target}>
    <div ref={target} className="shell-status" data-testid="shell-status" aria-live="polite">
      <div className="shell-default-capabilities">{fallback}</div>
    </div>
    {children}
  </StatusTarget>;
}

/** React owns the portal lifecycle, so a route's warnings disappear on unmount.
 * Outside a shell (isolated previews/tests), retain the ordinary inline view. */
export function StatusBanner({ children, kind = 'notice' }: { children: React.ReactNode; kind?: 'capability' | 'notice' }) {
  const slot = useContext(StatusTarget);
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    // Resolve the portal's DOM destination after refs attach; only this banner
    // rerenders, leaving the streamed page and its provider untouched.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTarget(slot?.current ?? null);
  }, [slot]);
  if (!slot) return children;
  if (!target) return <noscript>{children}</noscript>;
  return createPortal(<div data-status-kind={kind}>{children}</div>, target);
}
