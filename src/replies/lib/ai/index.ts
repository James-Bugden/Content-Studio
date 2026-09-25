import { serverConfig, type EnvSource } from '@/replies/lib/config/env';
import { createFakeGenerator, type FakeBehaviour } from './providers/fake';
import { createAnthropicGenerator } from './providers/anthropic';
import type { ReplyGenerator } from './types';

export * from './types';
export { generateIdeas, type GenerateOutcome } from './generator';
export { runGuards, type GuardReport } from './guards';
export {
  assembleRewriteInstruction,
  assembleTranslationInstruction,
  checkRewrite,
  parseRewriteOutput,
  parseTranslationOutput,
  type RewriteAction,
  type RewriteOutput,
} from './tasks';
export { assemblePrompt } from './prompts/assemble';
export { createFakeGenerator } from './providers/fake';

/**
 * Selects the generator from configuration.
 *
 * `null` means no provider is configured. That is a supported state and callers
 * must render it as one: retrieval, editing, copying and recording all keep working,
 * and the ideas section says it is not set up. What must never happen is a fake
 * result presented as a real one, which is why `fake` is only ever chosen by an
 * explicit `AI_PROVIDER=fake` and labels its own output.
 */
export function createGenerator(
  env: EnvSource = process.env,
  fakeBehaviour?: FakeBehaviour,
): ReplyGenerator | null {
  const config = serverConfig(env).generation;

  if (config.mode === 'fake') return createFakeGenerator(fakeBehaviour ?? {});
  if (config.mode === 'unconfigured') return null;

  switch (config.provider) {
    case 'anthropic':
      return createAnthropicGenerator({ apiKey: config.apiKey!, model: config.model });
    default:
      // A provider name nobody implemented is a configuration mistake, and running
      // as if it were absent is clearer than quietly using a different vendor.
      return null;
  }
}

