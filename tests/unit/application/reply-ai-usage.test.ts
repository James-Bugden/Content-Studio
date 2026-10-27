import { beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getAiUsage, resetAiUsage } from '@/application/ai-usage-container';
import { trackEmbedder, trackReplyGenerator } from '@/application/reply-ai-usage';
import { fakeEmbedder } from '@/replies/lib/embeddings/provider';
import { createFakeGenerator } from '@/replies/lib/ai/providers/fake';
import { generateIdeas } from '@/replies/lib/ai/generator';

beforeEach(resetAiUsage);
it('records Replies generation/rewrite/translation and embedding calls in the shared ledger', async () => {
  const generator = trackReplyGenerator(createFakeGenerator());
  for (const task of ['ideas', 'rewrite', 'translation'] as const) {
    await generator.complete('Synthetic instruction', 'Synthetic reply', { signal: new AbortController().signal, maxOutputTokens: 100, task });
  }
  expect((await trackEmbedder(fakeEmbedder()).embed(['Synthetic embedding'])).status).toBe('ok');
  expect((await getAiUsage().summary()).calls.map(c => c.feature)).toEqual(['embeddings', 'replies_translation', 'replies_rewrite', 'replies_ideas']);
});
it('a shared exhausted cap blocks all Replies/embedding providers without retries or network work', async () => {
  await getAiUsage().setCap({ operationId: randomUUID(), expectedVersion: 1, capMicros: 0, actorHash: 'a'.repeat(64) });
  const complete = vi.fn();
  const generator = trackReplyGenerator({ name: 'fake', model: 'fake', complete });
  const context = { platform: 'x' as const, sourceText: 'Synthetic text', parentText: null, writing: [], facts: [], resources: [], recentReplies: [], seedReplyIds: [] };
  await expect(generateIdeas(context, { generator })).rejects.toMatchObject({ code: 'monthly_ai_limit_reached', message: 'Monthly AI limit reached' });
  expect(complete).not.toHaveBeenCalled();
  const embed = vi.fn();
  expect(await trackEmbedder({ mode: 'fake', model: 'fake', embed }).embed(['Synthetic text'])).toMatchObject({ status: 'failed', code: 'monthly_ai_limit_reached', retryable: false });
  expect(embed).not.toHaveBeenCalled(); expect((await getAiUsage().summary()).calls).toHaveLength(0);
});
