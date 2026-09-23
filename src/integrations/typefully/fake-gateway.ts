import 'server-only';
import type { Capability } from '@/domain/capability';
import type { Platform } from '@/domain/enums';
import { AppError, type ErrorCode } from '@/domain/errors';
import { SYNTH_TYPEFULLY_DRAFTS, type SyntheticTypefullyDraft } from '@/fixtures/synthetic';
import type {
  TypefullyCreateInput,
  TypefullyDraft,
  TypefullyGateway,
  TypefullyMetricKey,
  TypefullyPublication,
} from '@/application/ports';

/**
 * In-memory Typefully (CS-015). Seeded from the synthetic Schedule.
 *
 * It behaves like the documented v2 API, including what the API does NOT do:
 * there is no idempotency key, so creating twice with the same key makes two
 * drafts. The key is only stored as a marker (like the real draft notes field)
 * that `findByIdempotencyKey` can look up. Tests therefore prove the service's
 * lookup-before-create logic, not a convenience the provider lacks.
 *
 * Fault injection:
 * - `failNext(code, op?)`: the next call (optionally of one operation) fails.
 * - `timeoutAfterCreateNext()`: the next create stores the draft and then throws
 *   PROVIDER_UNAVAILABLE, simulating a lost response.
 * - `editExternally(id, text)`: a human edit in Typefully (bumps `updatedAt`).
 * - `publishExternally(id, facts)`: Typefully publishes the draft.
 */
type Op = 'getDraft' | 'listDrafts' | 'findByIdempotencyKey' | 'createDraft' | 'updateDraft' | 'getPublication';

type Stored = {
  id: string;
  platform: Platform;
  text: string;
  status: TypefullyDraft['status'];
  scheduledAt?: string;
  updatedAt: string;
  publishedAt?: string;
  url?: string;
  marker?: string;
  metrics?: Partial<Record<TypefullyMetricKey, number>>;
};

export class FakeTypefullyGateway implements TypefullyGateway {
  private readonly store = new Map<string, Stored>();
  private failures: { code: ErrorCode; op?: Op }[] = [];
  private loseNextCreate = false;
  private nextId = 2001;
  private tick = 0;
  readonly calls: { op: Op; id?: string }[] = [];

  constructor(
    seed: readonly SyntheticTypefullyDraft[] = SYNTH_TYPEFULLY_DRAFTS,
    private readonly clock: () => Date = () => new Date(),
  ) {
    for (const d of seed) this.store.set(d.id, { ...d, ...(d.metrics ? { metrics: { ...d.metrics } } : {}) });
  }

  capability(): Capability {
    return { provider: 'typefully', mode: 'fake', state: 'ready' };
  }

  failNext(code: ErrorCode, op?: Op): void {
    this.failures.push({ code, ...(op ? { op } : {}) });
  }

  timeoutAfterCreateNext(): void {
    this.loseNextCreate = true;
  }

  /** Every draft currently held, for assertions (e.g. exactly one was created). */
  all(): TypefullyDraft[] {
    return [...this.store.values()].map(toDraft);
  }

  editExternally(id: string, text: string): void {
    const d = this.mustGet(id);
    d.text = text;
    d.updatedAt = this.stamp();
  }

  publishExternally(id: string, facts: { url?: string; publishedAt?: string; metrics?: Partial<Record<TypefullyMetricKey, number>> } = {}): void {
    const d = this.mustGet(id);
    d.status = 'Published';
    d.publishedAt = facts.publishedAt ?? this.stamp();
    if (facts.url) d.url = facts.url;
    if (facts.metrics) d.metrics = { ...facts.metrics };
    d.updatedAt = this.stamp();
  }

  setMetrics(id: string, metrics: Partial<Record<TypefullyMetricKey, number>> | undefined): void {
    const d = this.mustGet(id);
    if (metrics) d.metrics = { ...metrics };
    else delete d.metrics;
  }

  /** Strictly increasing timestamps even within one millisecond. */
  private stamp(): string {
    this.tick += 1;
    return new Date(this.clock().getTime() + this.tick).toISOString();
  }

  private maybeFail(op: Op, id?: string): void {
    this.calls.push({ op, ...(id ? { id } : {}) });
    const i = this.failures.findIndex((f) => !f.op || f.op === op);
    if (i < 0) return;
    const [f] = this.failures.splice(i, 1);
    throw new AppError(f!.code, { provider: 'typefully', injected: true });
  }

  private mustGet(id: string): Stored {
    const d = this.store.get(id);
    if (!d) throw new AppError('NOT_FOUND', { provider: 'typefully' });
    return d;
  }

  async getDraft(id: string): Promise<TypefullyDraft> {
    this.maybeFail('getDraft', id);
    return toDraft(this.mustGet(id));
  }

  async listDrafts(q: { platform: Platform; from: string; to: string }): Promise<TypefullyDraft[]> {
    this.maybeFail('listDrafts');
    const from = Date.parse(q.from);
    const to = Date.parse(q.to);
    return [...this.store.values()]
      .filter((d) => d.platform === q.platform && d.scheduledAt && Date.parse(d.scheduledAt) >= from && Date.parse(d.scheduledAt) <= to)
      .map(toDraft);
  }

  async findByIdempotencyKey(key: string): Promise<TypefullyDraft | null> {
    this.maybeFail('findByIdempotencyKey');
    const found = [...this.store.values()].filter((d) => d.marker === key);
    return found.length ? toDraft(found[0]!) : null;
  }

  async createDraft(input: TypefullyCreateInput): Promise<TypefullyDraft> {
    this.maybeFail('createDraft');
    const id = `SYNTH-TF-${this.nextId++}`;
    const timing = input.timing ?? 'plan';
    const d: Stored = {
      id,
      platform: input.platform,
      text: input.text,
      status: input.scheduleAt ? (timing === 'publish' ? 'Scheduled' : 'Planned') : 'Typefully Draft',
      ...(input.scheduleAt ? { scheduledAt: new Date(Date.parse(input.scheduleAt)).toISOString() } : {}),
      updatedAt: this.stamp(),
      marker: input.idempotencyKey,
    };
    this.store.set(id, d);
    if (this.loseNextCreate) {
      this.loseNextCreate = false;
      throw new AppError('PROVIDER_UNAVAILABLE', { provider: 'typefully', injected: 'timeout_after_create' });
    }
    return toDraft(d);
  }

  async updateDraft(id: string, patch: { text: string; expectedUpdatedAt: string }): Promise<TypefullyDraft> {
    this.maybeFail('updateDraft', id);
    const d = this.mustGet(id);
    if (Date.parse(d.updatedAt) !== Date.parse(patch.expectedUpdatedAt)) throw new AppError('CONFLICT', { provider: 'typefully', reason: 'draft_changed' });
    if (d.status === 'Published') throw new AppError('CONFLICT', { provider: 'typefully', reason: 'already_published' });
    d.text = patch.text;
    d.updatedAt = this.stamp();
    return toDraft(d);
  }

  async getPublication(id: string, platform?: Platform): Promise<TypefullyPublication> {
    this.maybeFail('getPublication', id);
    const d = this.mustGet(id);
    if (platform && platform !== d.platform) throw new AppError('NOT_FOUND', { provider: 'typefully', reason: 'platform_not_enabled' });
    const published = d.status === 'Published';
    return {
      status: d.status,
      ...(d.publishedAt ? { publishedAt: d.publishedAt } : {}),
      ...(d.url ? { url: d.url } : {}),
      finalText: d.text,
      // Mirrors the live matrix: post metrics exist for X only.
      ...(published && d.platform === 'X' && d.metrics ? { metrics: { ...d.metrics } } : {}),
    };
  }
}

function toDraft(d: Stored): TypefullyDraft {
  const view = { text: d.text, ...(d.url ? { url: d.url } : {}), ...(d.publishedAt ? { publishedAt: d.publishedAt } : {}) };
  return {
    id: d.id,
    platform: d.platform,
    platforms: [d.platform],
    text: d.text,
    status: d.status,
    ...(d.scheduledAt ? { scheduledAt: d.scheduledAt } : {}),
    updatedAt: d.updatedAt,
    ...(d.publishedAt ? { publishedAt: d.publishedAt } : {}),
    ...(d.url ? { url: d.url } : {}),
    perPlatform: { [d.platform]: view },
    ...(d.marker ? { idempotencyKey: d.marker } : {}),
  };
}

/** Live mode without a key or social set: every call is CONFIG_MISSING; manual work continues. */
export class UnconfiguredTypefullyGateway implements TypefullyGateway {
  capability(): Capability {
    return { provider: 'typefully', mode: 'live', state: 'not_configured', detail: 'Typefully API key or social set not configured' };
  }
  private refuse(): never {
    throw new AppError('CONFIG_MISSING', { provider: 'typefully' });
  }
  async getDraft(): Promise<TypefullyDraft> {
    return this.refuse();
  }
  async listDrafts(): Promise<TypefullyDraft[]> {
    return this.refuse();
  }
  async findByIdempotencyKey(): Promise<TypefullyDraft | null> {
    return this.refuse();
  }
  async createDraft(): Promise<TypefullyDraft> {
    return this.refuse();
  }
  async updateDraft(): Promise<TypefullyDraft> {
    return this.refuse();
  }
  async getPublication(): Promise<TypefullyPublication> {
    return this.refuse();
  }
}
