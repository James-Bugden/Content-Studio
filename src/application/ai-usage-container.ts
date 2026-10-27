import 'server-only';
import { AiUsageService } from './ai-usage';
import { FakeAiUsageRepository } from '@/integrations/supabase/fake-ai-usage';
import { SupabaseAiUsageRepository } from '@/integrations/supabase/ai-usage-repository';

const KEY = Symbol.for('content-studio.ai-usage');
const globalStore = globalThis as unknown as Record<symbol, AiUsageService | undefined>;
export function getAiUsage(): AiUsageService {
  if (globalStore[KEY]) return globalStore[KEY];
  const repository = process.env.CS_DATA_MODE === 'fake'
    ? new FakeAiUsageRepository()
    : liveRepository();
  return globalStore[KEY] = new AiUsageService(repository);
}
export function resetAiUsage(): void { delete globalStore[KEY]; }

/** Construct lazily: missing optional AI configuration must not break manual work. */
function liveRepository() {
  const repository = () => new SupabaseAiUsageRepository({ url: process.env.SUPABASE_READ_MODEL_URL ?? '', serviceKey: process.env.SUPABASE_READ_MODEL_SERVICE_KEY ?? '' });
  return {
    summary: () => repository().summary(),
    begin: (...args: Parameters<SupabaseAiUsageRepository['begin']>) => repository().begin(...args),
    finish: (...args: Parameters<SupabaseAiUsageRepository['finish']>) => repository().finish(...args),
    setCap: (...args: Parameters<SupabaseAiUsageRepository['setCap']>) => repository().setCap(...args),
  };
}
