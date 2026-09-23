/**
 * Capability states (MASTER-SPEC section 3). Adapters report what they can do so
 * no-match, not-configured, rate-limited, conflict and provider failure stay
 * distinct in the UI. Details are content-free.
 */
export const PROVIDERS = ['sheet', 'drive', 'typefully', 'ai', 'auth'] as const;
export type Provider = (typeof PROVIDERS)[number];

export type CapabilityState = 'ready' | 'read_only' | 'not_configured' | 'degraded' | 'unavailable';

export type Capability = {
  provider: Provider;
  state: CapabilityState;
  mode: 'fake' | 'live';
  /** Short, content-free reason, e.g. "write scope not configured". */
  detail?: string;
};

export function canWrite(capability: Capability | undefined): boolean {
  return capability?.state === 'ready';
}
