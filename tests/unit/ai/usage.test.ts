import { expect, it, vi } from 'vitest';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { AnthropicAiGateway } from '@/integrations/ai/anthropic-gateway';
import { ENGLISH_QA_TASK } from '@/application/english-qa';
import { AiUsageService } from '@/application/ai-usage';
import { FakeAiUsageRepository } from '@/integrations/supabase/fake-ai-usage';

it('records provider model and real token counts before a refusal, including cached input without inflating token counts', async () => {
  const repo = new FakeAiUsageRepository();
  const create = vi.fn(async () => ({ model: 'claude-sonnet-5', content: [], stop_reason: 'refusal',
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20, cache_creation_input_tokens: 30 } }) as unknown as BetaMessage);
  const ai = new AnthropicAiGateway({ apiKey: 'synthetic-no-network', usage: new AiUsageService(repo), messages: { create } });
  expect(await ai.run(ENGLISH_QA_TASK, { draft: 'Synthetic color.', platform: 'X' })).toMatchObject({ ok: false, code: 'PROVIDER_UNAVAILABLE' });
  expect(create).toHaveBeenCalledTimes(1);
  expect(repo.calls[0]).toMatchObject({ model: 'claude-sonnet-5', inputTokens: 150, outputTokens: 50, costMicros: 860, status: 'completed' });
});
