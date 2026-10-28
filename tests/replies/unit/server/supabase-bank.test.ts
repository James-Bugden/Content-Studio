import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { OwnerSession } from '@/replies/lib/auth/owner';
import { isAppError } from '@/replies/lib/contracts/errors';
import { POST_CANDIDATE_LIMIT, POST_CANDIDATE_SELECT } from '@/replies/lib/suggestions/library-posts';
import { createSupabaseStore } from '@/replies/lib/server/supabase-store';
import type { Store } from '@/replies/lib/server/store';

/**
 * #245 on the real Supabase store: the new queries, with a recording stand-in for
 * the PostgREST client.
 *
 * The stand-in is small on purpose. It records every call so the tests can assert
 * what the store asked the database for: that every query is scoped to the owner,
 * that the library search is bounded and excludes deleted posts, that bytea goes in
 * and out as PostgREST's hex text, and that a stale version cannot write.
 */

const OWNER = '00000000-0000-4000-8000-0000000000aa';
const SESSION = '33333333-3333-4333-8333-000000000001';
const SOURCE = '44444444-4444-4444-8444-000000000001';

type Row = Record<string, unknown>;
interface Call {
  table: string;
  op: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  select?: string;
  eq: [string, unknown][];
  is: [string, unknown][];
  in: [string, unknown[]][];
  or: string[];
  limit?: number;
  payload?: Row | Row[];
}

interface Chain {
  select(columns?: string): Chain;
  insert(payload: Row | Row[]): Chain;
  upsert(payload: Row): Chain;
  update(payload: Row): Chain;
  delete(): Chain;
  eq(column: string, value: unknown): Chain;
  is(column: string, value: unknown): Chain;
  in(column: string, values: unknown[]): Chain;
  or(filter: string): Chain;
  order(): Chain;
  limit(count: number): Chain;
  maybeSingle(): Promise<unknown>;
  single(): Promise<unknown>;
  then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown): Promise<unknown>;
}

function makeClient(tables: Record<string, Row[]>) {
  const calls: Call[] = [];
  let failInsert: string | null = null;

  const matches = (row: Row, call: Call) =>
    call.eq.every(([column, value]) => row[column] === value) &&
    call.is.every(([column, value]) => (row[column] ?? null) === value) &&
    call.in.every(([column, values]) => values.includes(row[column])) &&
    call.or.every((filter) =>
      filter.split(',').some((clause) => {
        const [column, operator, pattern] = clause.split('.');
        if (operator !== 'ilike') return false;
        const needle = String(pattern).replaceAll('%', '').toLowerCase();
        return String(row[column!] ?? '').toLowerCase().includes(needle);
      }),
    );

  function builder(table: string) {
    const call: Call = { table, op: 'select', eq: [], is: [], in: [], or: [] };
    let single: 'one' | 'maybe' | null = null;
    let returning = false;
    const rows = () => (tables[table] ??= []);

    const run = (): { data: unknown; error: { code: string } | null } => {
      calls.push(call);
      const target = rows();
      if (call.op === 'select') {
        let found = target.filter((row) => matches(row, call));
        if (call.limit !== undefined) found = found.slice(0, call.limit);
        if (single) return { data: found[0] ?? null, error: single === 'one' && !found[0] ? { code: 'PGRST116' } : null };
        return { data: found, error: null };
      }
      if (call.op === 'insert' || call.op === 'upsert') {
        if (failInsert === table) return { data: null, error: { code: '23505' } };
        const payloads = Array.isArray(call.payload) ? call.payload : [call.payload!];
        const made = payloads.map((payload) => {
          if (call.op === 'upsert') {
            const index = target.findIndex((row) => row.image_id === payload.image_id);
            if (index >= 0) {
              target[index] = { ...target[index], ...payload };
              return target[index]!;
            }
          }
          const unique = (key: string) => key in payload && target.some((row) => row[key] === payload[key] && row.user_id === payload.user_id);
          if (unique('request_key')) return null;
          const row = { id: `gen-${target.length + 1}`, version: 1, active: true, created_at: new Date().toISOString(), ...payload };
          target.push(row);
          return row;
        });
        if (made.includes(null)) return { data: null, error: { code: '23505' } };
        return { data: single ? made[0] : made, error: null };
      }
      if (call.op === 'update') {
        const found = target.filter((row) => matches(row, call));
        for (const row of found) Object.assign(row, call.payload);
        const data = returning ? found : null;
        return { data: single ? (found[0] ?? null) : data, error: null };
      }
      const found = target.filter((row) => matches(row, call));
      tables[table] = target.filter((row) => !found.includes(row));
      return { data: found, error: null };
    };

    const chain: Chain = {
      select(columns?: string) {
        if (call.op === 'select') call.select = columns;
        else returning = true;
        return chain;
      },
      insert(payload: Row | Row[]) {
        call.op = 'insert';
        call.payload = payload;
        return chain;
      },
      upsert(payload: Row) {
        call.op = 'upsert';
        call.payload = payload;
        return chain;
      },
      update(payload: Row) {
        call.op = 'update';
        call.payload = payload;
        return chain;
      },
      delete() {
        call.op = 'delete';
        return chain;
      },
      eq(column: string, value: unknown) {
        call.eq.push([column, value]);
        return chain;
      },
      is(column: string, value: unknown) {
        call.is.push([column, value]);
        return chain;
      },
      in(column: string, values: unknown[]) {
        call.in.push([column, values]);
        return chain;
      },
      or(filter: string) {
        call.or.push(filter);
        return chain;
      },
      order() {
        return chain;
      },
      limit(count: number) {
        call.limit = count;
        return chain;
      },
      maybeSingle() {
        single = 'maybe';
        return Promise.resolve(run());
      },
      single() {
        single = 'one';
        return Promise.resolve(run());
      },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    return chain;
  }

  const client = { from: builder, rpc: vi.fn() };
  return { client, calls, failInsertOn: (table: string | null) => (failInsert = table) };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function seed(): Record<string, Row[]> {
  return {
    reply_sessions: [{ id: SESSION, user_id: OWNER, source_post_id: SOURCE }],
    source_posts: [{ id: SOURCE, user_id: OWNER, source_text: 'Does a cover letter still matter when hiring managers skim?' }],
    facts: [
      { id: 'f-public', user_id: OWNER, version: 2, fact_text: 'I reviewed 300 cover letters.', tags: ['cover letter'], approved: true, active: true, sensitivity: 'public_safe', valid_from: null, valid_to: null },
      { id: 'f-private', user_id: OWNER, version: 2, fact_text: 'A private cover letter story.', tags: ['cover letter'], approved: true, active: true, sensitivity: 'private_context_only', valid_from: null, valid_to: null },
      { id: 'f-draft', user_id: OWNER, version: 1, fact_text: 'Unapproved cover letter story.', tags: ['cover letter'], approved: false, active: true, sensitivity: 'public_safe', valid_from: null, valid_to: null },
      { id: 'f-other', user_id: 'someone-else', version: 2, fact_text: 'Another owner cover letter fact.', tags: ['cover letter'], approved: true, active: true, sensitivity: 'public_safe', valid_from: null, valid_to: null },
    ],
    content_studio_posts: [
      { collection: 'library', library_id: 'LIB-1', deleted_at: null, current_hook: 'Cover letter openings', pesto: '', draft_content: 'Name the problem you solved in a cover letter.', content_source: '', target_platform: 'LinkedIn', image_file: 'https://drive.google.com/file/d/abcdefghij/view', image_file_url: '', image_alt_text: 'A cover letter diagram', image_brief: '' },
      { collection: 'library', library_id: 'LIB-DEL', deleted_at: '2026-10-01T00:00:00Z', current_hook: 'Deleted cover letter post', pesto: '', draft_content: 'cover letter', content_source: '', target_platform: 'X', image_file: '', image_file_url: '', image_alt_text: '', image_brief: '' },
      { collection: 'queue', library_id: 'Q-1', deleted_at: null, current_hook: 'Queue cover letter', pesto: '', draft_content: 'cover letter', content_source: '', target_platform: 'X', image_file: '', image_file_url: '', image_alt_text: '', image_brief: '' },
      { collection: 'library', library_id: 'LIB-NOPE', deleted_at: null, current_hook: 'Salary', pesto: '', draft_content: 'unrelated salary talk', content_source: '', target_platform: 'X', image_file: '', image_file_url: '', image_alt_text: '', image_brief: '' },
    ],
    reply_bank_images: [],
    reply_bank_image_files: [],
    reply_bank_image_audit: [],
    reply_suggestions: [],
    generation_runs: [],
  };
}

let tables: Record<string, Row[]>;
let harness: ReturnType<typeof makeClient>;
let store: Store;

beforeEach(() => {
  tables = seed();
  harness = makeClient(tables);
  store = createSupabaseStore({ userId: OWNER, supabase: harness.client } as unknown as OwnerSession);
});

const newImage = (overrides: Partial<Parameters<Store['createBankImage']>[0]> = {}) => ({
  requestKey: 'key-1',
  requestHash: 'hash-1',
  title: 'Checklist',
  altText: 'A checklist.',
  tags: ['cover letter'],
  origin: 'upload' as const,
  status: 'ready' as const,
  sketch: '',
  brief: '',
  file: { bytes: PNG, mime: 'image/png', sha256: 'a'.repeat(64) },
  ...overrides,
});

describe('suggestions on the real store', () => {
  it('searches only live Library posts, with a bounded query that selects only what it needs', async () => {
    const result = await store.suggestions({ sessionId: SESSION, factIds: [] });
    const query = harness.calls.find((call) => call.table === 'content_studio_posts')!;
    expect(query.eq).toContainEqual(['collection', 'library']);
    expect(query.is).toContainEqual(['deleted_at', null]);
    expect(query.limit).toBe(POST_CANDIDATE_LIMIT);
    expect(query.select).toBe(POST_CANDIDATE_SELECT);
    expect(query.or[0]).toContain('draft_content.ilike.%cover%');
    expect(result.posts.map((post) => post.id)).toEqual(['LIB-1']);
  });

  it('finds the image attached to a post, through the asset route and never the Drive link', async () => {
    const result = await store.suggestions({ sessionId: SESSION, factIds: [] });
    const image = result.images.find((candidate) => candidate.source === 'post')!;
    expect(image.url).toBe('/api/library/LIB-1/asset');
    expect(JSON.stringify(result)).not.toContain('drive.google.com');
  });

  it('matches bank images and post images together', async () => {
    await store.createBankImage(newImage());
    const result = await store.suggestions({ sessionId: SESSION, factIds: [] });
    expect(result.images.map((image) => image.source).sort()).toEqual(['bank', 'post']);
    expect(result.images.find((image) => image.source === 'bank')!.url).toMatch(/^\/api\/replies\/images\/.+\/file$/);
  });

  it('leaves out an inactive or still-a-sketch bank image', async () => {
    await store.createBankImage(newImage({ requestKey: 'sk', requestHash: 'h2', status: 'sketch', file: null, sketch: 'x' }));
    const off = await store.createBankImage(newImage({ requestKey: 'off', requestHash: 'h3' }));
    await store.updateBankImage({ id: off.id, expectedVersion: 1, requestKey: 'u', action: 'update', changes: { active: false } });
    const result = await store.suggestions({ sessionId: SESSION, factIds: [] });
    expect(result.images.map((image) => image.source)).toEqual(['post']);
  });

  it('offers this owner’s approved facts, with private ones tagged, and never an unapproved or foreign one', async () => {
    const { facts } = await store.suggestions({ sessionId: SESSION, factIds: [] });
    expect(facts.map((fact) => [fact.id, fact.private]).sort()).toEqual([
      ['f-private', true],
      ['f-public', false],
    ]);
    const factQuery = harness.calls.find((call) => call.table === 'facts')!;
    expect(factQuery.eq).toContainEqual(['user_id', OWNER]);
  });

  it('refuses a session that is not this owner’s', async () => {
    await expect(store.suggestions({ sessionId: 'nope', factIds: [] })).rejects.toSatisfy((error) => isAppError(error) && error.code === 'not_found');
  });

  it('scopes every owner table query to the owner', async () => {
    await store.suggestions({ sessionId: SESSION, factIds: [] });
    await store.createBankImage(newImage());
    await store.listBankImages();
    for (const call of harness.calls) {
      if (call.table === 'content_studio_posts') continue; // The Library is single-owner.
      if (call.op === 'insert' || call.op === 'upsert') {
        const payloads = Array.isArray(call.payload) ? call.payload : [call.payload!];
        for (const payload of payloads) expect(payload.user_id).toBe(OWNER);
      } else {
        expect(call.eq, `${call.table} ${call.op}`).toContainEqual(['user_id', OWNER]);
      }
    }
  });
});

describe('context extras on the real store', () => {
  it('returns the stored text for eligible facts only, and live posts only', async () => {
    const extras = await store.contextExtras({
      factIds: ['f-public', 'f-private', 'f-draft', 'f-other'],
      excludedFactIds: ['f-public'],
      postIds: ['LIB-1', 'LIB-DEL', 'Q-1'],
    });
    expect(extras.facts.map((fact) => fact.id).sort()).toEqual(['f-private', 'f-public']);
    expect(extras.excluded).toEqual([{ id: 'f-public', text: 'I reviewed 300 cover letters.' }]);
    expect(extras.posts.map((post) => post.id)).toEqual(['LIB-1']);
    const postQuery = harness.calls.find((call) => call.table === 'content_studio_posts')!;
    expect(postQuery.eq).toContainEqual(['collection', 'library']);
    expect(postQuery.is).toContainEqual(['deleted_at', null]);
  });

  it('does not touch the database for ids it was not given', async () => {
    await store.contextExtras({ factIds: [], excludedFactIds: [], postIds: [] });
    expect(harness.calls).toHaveLength(0);
  });
});

describe('saved ideas', () => {
  it('only returns an idea whose run belongs to the session asked about', async () => {
    tables.reply_suggestions!.push({ id: 'idea-1', user_id: OWNER, generation_run_id: 'run-1', reply_text: 'Idea text', english_meaning: null, fact_ids: ['f-public'] });
    tables.generation_runs!.push({ id: 'run-1', user_id: OWNER, session_id: SESSION });
    expect(await store.getSuggestion(SESSION, 'idea-1')).toEqual({ reply_text: 'Idea text', english_meaning: null, uses_fact_ids: ['f-public'] });
    expect(await store.getSuggestion('another-session', 'idea-1')).toBeNull();
    expect(await store.getSuggestion(SESSION, 'missing')).toBeNull();
  });
});

describe('the image bank on the real store', () => {
  it('sends bytes as PostgREST hex text and reads them back exactly', async () => {
    const made = await store.createBankImage(newImage());
    const insert = harness.calls.find((call) => call.table === 'reply_bank_image_files' && call.op === 'insert')!;
    expect((insert.payload as Row).bytes).toBe('\\x89504e470d0a1a0a010203');
    expect(await store.readBankImageFile(made.id)).toEqual({ bytes: PNG, mime: 'image/png' });
  });

  it('keeps bytes out of every listing', async () => {
    await store.createBankImage(newImage());
    await store.listBankImages();
    const listing = harness.calls.filter((call) => call.table === 'reply_bank_images' && call.op === 'select').at(-1)!;
    expect(listing.select).not.toContain('bytes');
    expect(listing.select).not.toContain('request_hash');
    expect(listing.select).not.toContain('sha256');
  });

  it('replays the same key and refuses the same key with other details', async () => {
    const first = await store.createBankImage(newImage());
    const again = await store.createBankImage(newImage());
    expect(again).toEqual({ id: first.id, version: 1, replayed: true });
    expect(tables.reply_bank_images).toHaveLength(1);
    await expect(store.createBankImage(newImage({ requestHash: 'different' }))).rejects.toSatisfy(
      (error) => isAppError(error) && error.code === 'idempotency_conflict',
    );
  });

  it('removes the row again if its bytes could not be stored', async () => {
    harness.failInsertOn('reply_bank_image_files');
    await expect(store.createBankImage(newImage())).rejects.toBeTruthy();
    expect(tables.reply_bank_images).toHaveLength(0);
  });

  it('writes an audit record for create, update and delete', async () => {
    const made = await store.createBankImage(newImage());
    await store.updateBankImage({ id: made.id, expectedVersion: 1, requestKey: 'u1', action: 'update', changes: { title: 'New' } });
    await store.deleteBankImage({ id: made.id, expectedVersion: 2, requestKey: 'd1' });
    expect(tables.reply_bank_image_audit!.map((row) => [row.action, row.request_key])).toEqual([
      ['create', 'key-1'],
      ['update', 'u1'],
      ['delete', 'd1'],
    ]);
    expect(tables.reply_bank_image_audit!.every((row) => row.user_id === OWNER)).toBe(true);
  });

  it('writes only on a matching version, so a stale form cannot overwrite', async () => {
    const made = await store.createBankImage(newImage());
    await store.updateBankImage({ id: made.id, expectedVersion: 1, requestKey: 'u1', action: 'update', changes: { title: 'Newer' } });
    await expect(
      store.updateBankImage({ id: made.id, expectedVersion: 1, requestKey: 'u2', action: 'update', changes: { title: 'Older' } }),
    ).rejects.toSatisfy((error) => isAppError(error) && error.code === 'version_conflict');
    expect(tables.reply_bank_images![0]!.title).toBe('Newer');
    expect(tables.reply_bank_images![0]!.version).toBe(2);
  });

  it('replays an update with the same key instead of applying it twice', async () => {
    const made = await store.createBankImage(newImage());
    await store.updateBankImage({ id: made.id, expectedVersion: 1, requestKey: 'u1', action: 'update', changes: { title: 'Once' } });
    const again = await store.updateBankImage({ id: made.id, expectedVersion: 1, requestKey: 'u1', action: 'update', changes: { title: 'Once' } });
    expect(again.version).toBe(2);
  });

  it('attaches a rendered file to a sketch, which makes it ready', async () => {
    const sketch = await store.createBankImage(newImage({ requestKey: 'sk', requestHash: 'h', status: 'sketch', file: null, sketch: 'a sketch', brief: 'a brief' }));
    expect(await store.readBankImageFile(sketch.id)).toBeNull();
    await store.updateBankImage({
      id: sketch.id, expectedVersion: 1, requestKey: 'a1', action: 'attach', changes: {}, file: { bytes: PNG, mime: 'image/png', sha256: 'b'.repeat(64) },
    });
    const row = (await store.getBankImage(sketch.id))!;
    expect(row).toMatchObject({ status: 'ready', mime_type: 'image/png', byte_size: PNG.length });
    expect(await store.readBankImageFile(sketch.id)).toEqual({ bytes: PNG, mime: 'image/png' });
  });

  it('deletes only the matching version, replays safely and says not found otherwise', async () => {
    const made = await store.createBankImage(newImage());
    await expect(store.deleteBankImage({ id: made.id, expectedVersion: 9, requestKey: 'd0' })).rejects.toSatisfy(
      (error) => isAppError(error) && error.code === 'version_conflict',
    );
    await store.deleteBankImage({ id: made.id, expectedVersion: 1, requestKey: 'd1' });
    await store.deleteBankImage({ id: made.id, expectedVersion: 1, requestKey: 'd1' });
    await expect(store.deleteBankImage({ id: made.id, expectedVersion: 1, requestKey: 'd2' })).rejects.toSatisfy(
      (error) => isAppError(error) && error.code === 'not_found',
    );
  });
});
