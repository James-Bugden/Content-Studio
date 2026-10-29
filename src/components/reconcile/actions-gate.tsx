'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * CS #250: Fix issues streams its slow provider checks. Write-class actions on the
 * page (imports, cutover steps, Markdown applies) stay visible but disabled until
 * every streamed check has finished successfully, so nobody acts on a partial
 * picture or while a source is unreadable. Each streamed section reports its
 * state here; a fresh Retry that succeeds re-enables them.
 */
export type SectionCheckState = 'loading' | 'ok' | 'failed';
export type ActionsGate = { enabled: boolean; reason: string | null; state: 'checking' | 'blocked' | 'ready' };

export const GATE_WAITING = 'Waiting for checks to finish.';
export const GATE_FAILED = 'Fix the unreadable source first, then retry the check.';

const OPEN: ActionsGate = { enabled: true, reason: null, state: 'ready' };
type Ctx = { gate: ActionsGate; report: (id: string, state: SectionCheckState) => void };
const GateContext = createContext<Ctx | null>(null);

export function gateFor(sections: readonly string[], states: Record<string, SectionCheckState>): ActionsGate {
  const values = [...new Set([...sections, ...Object.keys(states)])].map((id) => states[id] ?? 'loading');
  if (values.includes('failed')) return { enabled: false, reason: GATE_FAILED, state: 'blocked' };
  if (values.includes('loading')) return { enabled: false, reason: GATE_WAITING, state: 'checking' };
  return OPEN;
}

export function ReconcileActionsProvider({ sections, children }: { sections: readonly string[]; children: React.ReactNode }) {
  // Every expected section starts as loading, so server HTML and the first client
  // render keep actions disabled until the sections themselves report.
  const [states, setStates] = useState<Record<string, SectionCheckState>>(() => Object.fromEntries(sections.map((id) => [id, 'loading'])));
  const report = useCallback((id: string, state: SectionCheckState) => setStates((prev) => (prev[id] === state ? prev : { ...prev, [id]: state })), []);
  const gate = gateFor(sections, states);
  const value = useMemo(() => ({ gate, report }), [gate, report]);
  return (
    <GateContext.Provider value={value}>
      <div hidden data-reconcile-checks={gate.state} />
      {children}
    </GateContext.Provider>
  );
}

/** Outside the Fix issues provider (other pages, isolated tests) actions are not gated. */
export function useActionsGate(): ActionsGate {
  return useContext(GateContext)?.gate ?? OPEN;
}

/** Rendered by each streamed section (and its skeleton) to report its state. */
export function SectionGate({ id, state }: { id: string; state: SectionCheckState }) {
  const report = useContext(GateContext)?.report;
  useEffect(() => {
    if (!report) return;
    report(id, state);
    // Unmounting (skeleton replaced, or a re-check) returns the section to unknown.
    return () => report(id, 'loading');
  }, [id, state, report]);
  return null;
}
