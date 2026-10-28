import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aiFeatureSchema } from '@/domain/ai-usage';

/**
 * #245 migration: the Replies image bank and the AI usage feature list.
 *
 * Applied twice to prove it is replayable, against just enough of the platform
 * (an auth schema and the roles hosted Supabase provides).
 */

const MIGRATION = 'supabase/migrations/20261028000100_reply_bank_images.sql';
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const hash = 'a'.repeat(64);

let pg: PGlite;

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(`
    create schema if not exists auth;
    create table auth.users (id uuid primary key);
    create role anon nologin noinherit;
    create role authenticated nologin noinherit;
    create role service_role nologin noinherit bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create or replace function public.set_updated_at() returns trigger language plpgsql set search_path = '' as $$
    begin new.updated_at := now(); return new; end; $$;
    insert into auth.users (id) values ('${OWNER}'), ('${OTHER}');
  `);
  await pg.exec(readFileSync('supabase/migrations/20261027000300_ai_usage.sql', 'utf8'));
  await pg.exec(readFileSync(MIGRATION, 'utf8'));
  // Replayable: the second application must change nothing and fail nothing.
  await pg.exec(readFileSync(MIGRATION, 'utf8'));
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

const image = (overrides: Record<string, unknown> = {}) => {
  const row: Record<string, unknown> = {
    user_id: OWNER,
    request_key: crypto.randomUUID(),
    request_hash: 'h',
    title: 'Checklist',
    status: 'ready',
    mime_type: 'image/png',
    byte_size: 10,
    sha256: hash,
    tags: [],
    origin: 'upload',
    sketch: '',
    ...overrides,
  };
  return pg.query<{ id: string }>(
    `insert into reply_bank_images (user_id, request_key, request_hash, title, status, mime_type, byte_size, sha256, tags, origin, sketch)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [row.user_id, row.request_key, row.request_hash, row.title, row.status, row.mime_type, row.byte_size, row.sha256, row.tags, row.origin, row.sketch],
  );
};

describe('AI usage features', () => {
  it('accepts exactly the features the application knows, including bank_image_tags', async () => {
    const features = aiFeatureSchema.options;
    expect(features).toContain('bank_image_tags');
    for (const feature of features) {
      await pg.query(
        "insert into content_studio_ai_calls(id, feature, model, input_tokens, output_tokens, cost_micros, status) values ($1,$2,'fake',1,1,1,'completed')",
        [crypto.randomUUID(), feature],
      );
    }
    await expect(
      pg.query(
        "insert into content_studio_ai_calls(id, feature, model, input_tokens, output_tokens, cost_micros, status) values ($1,'unknown','fake',1,1,1,'completed')",
        [crypto.randomUUID()],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('lists every feature in the constraint, matching the TypeScript list one for one', async () => {
    const { rows } = await pg.query<{ definition: string }>(
      "select pg_get_constraintdef(oid) as definition from pg_constraint where conname = 'content_studio_ai_calls_feature_check'",
    );
    const listed = [...rows[0]!.definition.matchAll(/'([a-z_]+)'::text/g)].map((match) => match[1]!).sort();
    expect(listed).toEqual([...aiFeatureSchema.options].sort());
    for (const name of ['english_qa', 'hooks', 'zh_tw', 'zh_qa', 'replies_ideas', 'replies_rewrite', 'replies_translation', 'embeddings', 'image_check', 'ascii_sketch', 'image_render', 'image_need', 'bank_image_tags']) {
      expect(listed).toContain(name);
    }
  });
});

describe('image bank table', () => {
  it('accepts an uploaded image and a created sketch with no file yet', async () => {
    await image();
    await image({ status: 'sketch', mime_type: null, byte_size: 0, sha256: null, origin: 'created', sketch: 'a sketch' });
  });

  it('refuses a ready image with no file details, and a sketch that claims a file', async () => {
    await expect(image({ mime_type: null })).rejects.toThrow(/check constraint/);
    await expect(image({ byte_size: 0 })).rejects.toThrow(/check constraint/);
    await expect(image({ sha256: null })).rejects.toThrow(/check constraint/);
    await expect(image({ status: 'sketch' })).rejects.toThrow(/check constraint/);
  });

  it('refuses a type outside PNG, JPEG and WebP, and anything over 5 MB', async () => {
    await expect(image({ mime_type: 'image/svg+xml' })).rejects.toThrow(/check constraint/);
    await expect(image({ mime_type: 'image/gif' })).rejects.toThrow(/check constraint/);
    await expect(image({ byte_size: 5 * 1024 * 1024 + 1 })).rejects.toThrow(/check constraint/);
    await image({ mime_type: 'image/webp', byte_size: 5 * 1024 * 1024 });
  });

  it('refuses a blank title, too many tags and a bad digest', async () => {
    await expect(image({ title: '   ' })).rejects.toThrow(/check constraint/);
    await expect(image({ tags: Array.from({ length: 21 }, (_, index) => `t${index}`) })).rejects.toThrow(/check constraint/);
    await expect(image({ sha256: 'not-a-digest' })).rejects.toThrow(/check constraint/);
  });

  it('makes a request key unique per owner, so a replay cannot add a second row', async () => {
    const key = crypto.randomUUID();
    await image({ request_key: key });
    await expect(image({ request_key: key })).rejects.toThrow(/unique|duplicate/);
    await image({ request_key: key, user_id: OTHER });
  });

  it('keeps the bytes in their own table, capped at 5 MB, and deletes them with the image', async () => {
    const made = await image();
    const id = made.rows[0]!.id;
    await pg.query("insert into reply_bank_image_files (image_id, user_id, bytes) values ($1,$2,'\\x89504e47')", [id, OWNER]);
    await expect(
      pg.query("insert into reply_bank_image_files (image_id, user_id, bytes) values ($1,$2,'\\x')", [(await image()).rows[0]!.id, OWNER]),
    ).rejects.toThrow(/check constraint/);
    await expect(
      pg.query('insert into reply_bank_image_files (image_id, user_id, bytes) values ($1,$2,convert_to(repeat($3, 5242881), $4::name))', [
        (await image()).rows[0]!.id, OWNER, 'a', 'UTF8',
      ]),
    ).rejects.toThrow(/check constraint/);
    await pg.query('delete from reply_bank_images where id = $1', [id]);
    expect((await pg.query('select 1 from reply_bank_image_files where image_id = $1', [id])).rows).toHaveLength(0);
  });

  it('bumps updated_at on change', async () => {
    const made = (await image()).rows[0]!;
    const before = (await pg.query<{ updated_at: Date }>('select updated_at from reply_bank_images where id = $1', [made.id])).rows[0]!;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await pg.query("update reply_bank_images set title = 'New' where id = $1", [made.id]);
    const after = (await pg.query<{ updated_at: Date }>('select updated_at from reply_bank_images where id = $1', [made.id])).rows[0]!;
    expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
  });
});

describe('access', () => {
  const tables = ['reply_bank_images', 'reply_bank_image_files', 'reply_bank_image_audit'];

  it('turns row level security on for every new table', async () => {
    const { rows } = await pg.query<{ relname: string; relrowsecurity: boolean }>(
      'select relname, relrowsecurity from pg_class where relname = any($1)',
      [tables],
    );
    expect(rows.map((row) => row.relname).sort()).toEqual([...tables].sort());
    expect(rows.every((row) => row.relrowsecurity)).toBe(true);
  });

  it('gives the browser roles nothing, and the service role what it needs', async () => {
    for (const table of tables) {
      for (const role of ['anon', 'authenticated']) {
        const { rows } = await pg.query<{ has: boolean }>(
          "select has_table_privilege($1, $2, 'select,insert,update,delete') as has",
          [role, `public.${table}`],
        );
        expect(rows[0]!.has, `${role} on ${table}`).toBe(false);
        for (const privilege of ['select', 'insert', 'update', 'delete']) {
          expect((await pg.query<{ has: boolean }>('select has_table_privilege($1, $2, $3) as has', [role, `public.${table}`, privilege])).rows[0]!.has).toBe(false);
        }
      }
    }
    for (const table of tables.slice(0, 2)) {
      for (const privilege of ['select', 'insert', 'update', 'delete']) {
        expect((await pg.query<{ has: boolean }>('select has_table_privilege($1, $2, $3) as has', ['service_role', `public.${table}`, privilege])).rows[0]!.has).toBe(true);
      }
    }
    // The audit trail is append-only for the service role.
    expect((await pg.query<{ has: boolean }>("select has_table_privilege('service_role', 'public.reply_bank_image_audit', 'update') as has")).rows[0]!.has).toBe(false);
    expect((await pg.query<{ has: boolean }>("select has_table_privilege('service_role', 'public.reply_bank_image_audit', 'delete') as has")).rows[0]!.has).toBe(false);
  });

  it('keeps the audit record when the image is deleted', async () => {
    const made = (await image()).rows[0]!;
    await pg.query("insert into reply_bank_image_audit (user_id, image_id, action, request_key) values ($1,$2,'create','k')", [OWNER, made.id]);
    await pg.query('delete from reply_bank_images where id = $1', [made.id]);
    expect((await pg.query('select 1 from reply_bank_image_audit where image_id = $1', [made.id])).rows).toHaveLength(1);
  });
});
