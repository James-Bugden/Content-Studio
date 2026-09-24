import type { Capability, CapabilityState, Provider } from '@/domain/capability';

/**
 * Tells the owner which integrations are limited and what still works (CS-006).
 *
 * Ready providers are omitted so the banner only appears when something needs
 * attention. Each line names the provider, its state in words and the concrete
 * consequence, so a missing Typefully key never reads like a broken app.
 */
const NAMES: Record<Provider, string> = {
  sheet: 'Google Sheet',
  drive: 'Google Drive',
  typefully: 'Typefully',
  ai: 'AI assistant',
  auth: 'Sign-in',
};

const STATE_WORDS: Record<Exclude<CapabilityState, 'ready'>, string> = {
  not_configured: 'not configured',
  read_only: 'read-only',
  degraded: 'degraded',
  unavailable: 'unavailable',
};

/** What a limited provider means in practice, and what is still safe. */
const IMPACT: Record<Provider, string> = {
  sheet: 'saving is disabled and nothing will be written; what is shown may be out of date',
  drive: 'Markdown saves are disabled; the Sheet copy still shows',
  typefully: 'publishing actions are disabled; review still works',
  ai: 'QA and hook suggestions are off; manual review still works',
  auth: 'signing in may fail; nothing is changed',
};

export function capabilityMessage(capability: Capability): string {
  const state = capability.state === 'ready' ? 'ready' : STATE_WORDS[capability.state];
  return `${NAMES[capability.provider]} ${state}: ${IMPACT[capability.provider]}`;
}

export function CapabilityBanner({ capabilities }: { capabilities: Capability[] }) {
  const limited = capabilities.filter((c) => c.state !== 'ready');
  if (limited.length === 0) return null;
  return (
    <section aria-label="Integration status" className="mb-6 rounded-lg border border-line border-l-4 bg-card px-4 py-3 text-sm">
      <p className="flex items-center gap-2 font-semibold text-ink">
        <span aria-hidden="true" className="inline-flex size-5 items-center justify-center rounded-full border border-current text-xs">
          i
        </span>
        {limited.length === 1 ? 'One integration is limited' : `${limited.length} integrations are limited`}
      </p>
      <ul className="mt-1 space-y-1 text-ink">
        {limited.map((c) => (
          <li key={c.provider}>
            {capabilityMessage(c)}.{c.detail ? <span className="text-ink-soft"> ({c.detail})</span> : null}
            {c.mode === 'fake' ? <span className="text-ink-soft"> Using synthetic data.</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
