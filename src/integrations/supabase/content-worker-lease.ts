import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ContentShadowStore } from './content-shadow-store';
import type { SupabaseContentDbOptions } from './content-db';
import { AppError } from '@/domain/errors';

const ok = z.object({ ok: z.literal(true) });
/** Distributed worker exclusion without authority or cutover evidence checks.
 * Reuses the existing expiring, token-fenced lease shared by old deployments. */
export class ContentWorkerLease {
  private readonly rest: ContentShadowStore;
  private token?: string;
  constructor(options: SupabaseContentDbOptions, private readonly name = 'markdown-export') {
    this.rest = new ContentShadowStore(options);
  }
  async run(work: () => Promise<void>) {
    const token = randomUUID();
    ok.parse(await this.rest.cutoverRpc('claim', { p_name: this.name, p_token: token }));
    this.token = token;
    try { await work(); }
    finally {
      this.token = undefined;
      await this.rest.cutoverRpc('release', { p_name: this.name, p_token: token }).catch(() => { /* Lease expires on response loss. */ });
    }
  }
  async fence() {
    if (!this.token) throw new AppError('FORBIDDEN', { reason: 'worker_token_required' });
    ok.parse(await this.rest.cutoverRpc('fence', { p_name: this.name, p_token: this.token }));
  }
}
