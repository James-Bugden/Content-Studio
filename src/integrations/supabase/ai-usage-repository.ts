import 'server-only';
import { z } from 'zod';
import type { AiUsageRepository } from '@/application/ai-usage';
import { aiCallSchema, aiCapSchema, aiUsageSchema, type AiCall, type AiCapChange } from '@/domain/ai-usage';
import { AppError, isAppError } from '@/domain/errors';

export class SupabaseAiUsageRepository implements AiUsageRepository {
  private readonly base: string;
  constructor(private readonly options: { url: string; serviceKey: string; fetch?: typeof fetch }) {
    if (!/^(?:https:\/\/[a-z0-9-]+\.supabase\.co|http:\/\/(?:127\.0\.0\.1|localhost):54321)\/?$/i.test(options.url)
      || options.serviceKey.trim().length < 20) throw new AppError('CONFIG_MISSING', { provider: 'db' });
    this.base = options.url.replace(/\/$/, '');
  }
  private async rpc(action: string, data: unknown = {}): Promise<unknown> {
    try {
      const response = await (this.options.fetch ?? fetch)(`${this.base}/rest/v1/rpc/content_studio_ai_usage`, {
        method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(10_000),
        headers: { apikey: this.options.serviceKey, Authorization: `Bearer ${this.options.serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_action: action, p_data: data }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const code = z.object({ code: z.string() }).safeParse(body);
        throw new AppError(code.success && code.data.code === 'AL001' ? 'AI_LIMIT_REACHED'
          : code.success && code.data.code === 'AC001' ? 'CONFLICT' : code.success && code.data.code === 'AS001' ? 'STALE_READ' : 'PROVIDER_UNAVAILABLE');
      }
      return body;
    } catch (error) {
      if (isAppError(error)) throw error;
      throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'db' });
    }
  }
  async summary() {
    const parsed = aiUsageSchema.safeParse(await this.rpc('summary'));
    if (!parsed.success) throw new AppError('SCHEMA_DRIFT', { provider: 'db' });
    return parsed.data;
  }
  private async mutate(action: string, data: unknown) {
    if (!z.object({ ok: z.literal(true) }).safeParse(await this.rpc(action, data)).success) throw new AppError('SCHEMA_DRIFT', { provider: 'db' });
  }
  async begin(call: Omit<AiCall, 'timestamp' | 'status'>) {
    aiCallSchema.omit({ timestamp: true, status: true }).parse(call);
    await this.mutate('begin', call);
  }
  async finish(call: Pick<AiCall, 'id' | 'model' | 'inputTokens' | 'outputTokens' | 'costMicros' | 'status'>) {
    aiCallSchema.omit({ timestamp: true, feature: true }).parse(call);
    await this.mutate('finish', call);
  }
  async setCap(change: AiCapChange) {
    const parsed = aiCapSchema.extend({ actorHash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(change);
    await this.mutate('set_cap', parsed);
  }
}
