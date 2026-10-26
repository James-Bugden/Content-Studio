'use client';

import { createContext, useContext, useState } from 'react';
import { createPortal } from 'react-dom';

const StatusTarget = createContext<{ target: HTMLDivElement | null } | null>(null);

/** A shared presentation slot only. Provider state still comes from existing reads. */
export function ShellStatusProvider({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  return <StatusTarget value={{ target }}>
    <div ref={setTarget} className="shell-status" data-testid="shell-status" aria-live="polite">
      <div className="shell-default-capabilities">{fallback}</div>
    </div>
    {children}
  </StatusTarget>;
}

/** React owns the portal lifecycle, so a route's warnings disappear on unmount.
 * Outside a shell (isolated previews/tests), retain the ordinary inline view. */
export function StatusBanner({ children, kind = 'notice' }: { children: React.ReactNode; kind?: 'capability' | 'notice' }) {
  const slot = useContext(StatusTarget);
  if (!slot) return children;
  if (!slot.target) return <noscript>{children}</noscript>;
  return createPortal(<div data-status-kind={kind}>{children}</div>, slot.target);
}
