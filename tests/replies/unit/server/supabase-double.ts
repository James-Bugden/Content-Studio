import type { SupabaseClient } from '@supabase/supabase-js';
import type { QueryRunner, TestDatabase } from '../../support/db';

/**
 * A stand-in for the one part of `@supabase/supabase-js` the real store uses.
 *
 * It is a translator, not a simulator. Every chain it accepts is turned into one
 * statement and handed to the PGlite harness, running inside a transaction as
 * the server-only role used after Google owner authentication. This mirrors the
 * combined app: its service credential bypasses RLS, so every store query must
 * carry the explicit immutable owner id. The double's own logic is
 * limited to assembling SQL and reshaping the result into PostgREST's
 * `{ data, error }` envelope, which is the part the store actually reasons about:
 * `supabase-store.ts` decides what to do with a failed read and a duplicate key,
 * and neither of those is observable through the in-memory double the browser
 * journeys use.
 *
 * What it deliberately does not do is invent behaviour. Anything the store does
 * not call throws, so a chain that quietly did nothing could never be mistaken
 * for a passing test.
 */

export interface RecordedStatement {
  sql: string;
  params: unknown[];
}

export interface SupabaseDouble {
  client: SupabaseClient;
  /** Every statement that reached the database, in order. */
  statements: RecordedStatement[];
  /** Forces the next statement whose SQL contains `needle` to fail. */
  failNext(needle: string, code?: string): void;
}

interface Envelope<T> {
  data: T | null;
  error: { code?: string; message?: string } | null;
  count?: number | null;
}

type Row = Record<string, unknown>;

interface Filter {
  column: string;
  /** `is null` is its own operator because `= null` is never true. */
  operator: 'eq' | 'gte' | 'isNull';
  value?: unknown;
}

interface Plan {
  table: string;
  action: 'select' | 'insert' | 'update' | 'upsert';
  columns: string;
  returning: string | null;
  values: Row[];
  onConflict: string | null;
  filters: Filter[];
  order: { column: string; ascending: boolean } | null;
  limit: number | null;
  head: boolean;
  count: boolean;
}

/**
 * Values on their way into a statement.
 *
 * PGlite formats a JS array for the array types it knows and falls back to
 * `String(value)` for the ones it does not, which turns `['linkedin']` into the
 * bare word `linkedin` and fails against a `platform[]` column. Writing the
 * array literal here means the parameter arrives as text that Postgres parses in
 * whatever array type the target column declares, exactly as the wire protocol
 * would deliver it from PostgREST.
 */
function toParameter(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const elements = value.map((element) => {
    if (element === null) return 'NULL';
    const escaped = String(element).split('\\').join('\\\\').split('"').join('\\"');
    return `"${escaped}"`;
  });
  return `{${elements.join(',')}}`;
}

/**
 * Values on their way back out.
 *
 * PGlite hands back a `Date` for both `date` and `timestamptz`, where PostgREST
 * returns `2026-09-22` for the first and a full ISO instant for the second. The
 * distinction matters to the store, so it is restored by column name: every
 * `*_date` column in this schema is a `date`. It is a translation, not a
 * behaviour: nothing here changes what the database stored.
 */
function fromColumn(column: string, value: unknown): unknown {
  if (!(value instanceof Date)) return value;
  const iso = value.toISOString();
  return column.endsWith('_date') ? iso.slice(0, 10) : iso;
}

function quote(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`refusing to build SQL for an unexpected identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function whereClause(filters: readonly Filter[], params: unknown[]): string {
  if (filters.length === 0) return '';
  const parts = filters.map((filter) => {
    if (filter.operator === 'isNull') return `${quote(filter.column)} is null`;
    params.push(filter.value);
    return `${quote(filter.column)} ${filter.operator === 'eq' ? '=' : '>='} $${params.length}`;
  });
  return ` where ${parts.join(' and ')}`;
}

function buildStatement(plan: Plan): RecordedStatement {
  const params: unknown[] = [];
  const table = `public.${quote(plan.table)}`;

  if (plan.action === 'select') {
    const projection = plan.count ? 'count(*)::int as count' : plan.columns;
    let sql = `select ${projection} from ${table}${whereClause(plan.filters, params)}`;
    if (plan.order && !plan.count) {
      sql += ` order by ${quote(plan.order.column)} ${plan.order.ascending ? 'asc' : 'desc'}`;
    }
    if (plan.limit !== null && !plan.count) sql += ` limit ${plan.limit}`;
    return { sql, params };
  }

  if (plan.action === 'update') {
    const first = plan.values[0];
    if (!first) throw new Error('update with no values');
    const assignments = Object.entries(first).map(([column, value]) => {
      params.push(toParameter(value));
      return `${quote(column)} = $${params.length}`;
    });
    let sql = `update ${table} set ${assignments.join(', ')}${whereClause(plan.filters, params)}`;
    if (plan.returning) sql += ` returning ${plan.returning}`;
    return { sql, params };
  }

  // insert and upsert differ only by the conflict clause.
  const columns = [...new Set(plan.values.flatMap((row) => Object.keys(row)))];
  const tuples = plan.values.map((row) => {
    const placeholders = columns.map((column) => {
      params.push(toParameter(row[column] ?? null));
      return `$${params.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  let sql =
    `insert into ${table} (${columns.map(quote).join(', ')}) values ${tuples.join(', ')}`;
  if (plan.action === 'upsert' && plan.onConflict) {
    const assignments = columns
      .filter((column) => !plan.onConflict!.split(',').map((c) => c.trim()).includes(column))
      .map((column) => `${quote(column)} = excluded.${quote(column)}`);
    sql += ` on conflict (${plan.onConflict.split(',').map((c) => quote(c.trim())).join(', ')})`;
    sql += assignments.length > 0 ? ` do update set ${assignments.join(', ')}` : ' do nothing';
  }
  if (plan.returning) sql += ` returning ${plan.returning}`;
  return { sql, params };
}

export function createSupabaseDouble(db: TestDatabase): SupabaseDouble {
  const statements: RecordedStatement[] = [];
  const forced: { needle: string; code: string }[] = [];

  async function run<T>(statement: RecordedStatement): Promise<Envelope<T>> {
    statements.push(statement);

    const forcedIndex = forced.findIndex((entry) => statement.sql.includes(entry.needle));
    if (forcedIndex >= 0) {
      const [entry] = forced.splice(forcedIndex, 1);
      // Shaped like PostgREST's own failure, because the point of these tests is
      // what the store does with `error` rather than how the error was produced.
      return { data: null, error: { code: entry!.code, message: 'forced failure' } };
    }

    try {
      const rows = await db.asService(async (q: QueryRunner) => {
        const result = await q.query<Row>(statement.sql, statement.params);
        return result.rows;
      });
      const shaped = rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([column, value]) => [column, fromColumn(column, value)]),
        ),
      );
      return { data: shaped as unknown as T, error: null };
    } catch (error) {
      const code = (error as Error & { code?: string }).code;
      return { data: null, error: { ...(code ? { code } : {}), message: 'database error' } };
    }
  }

  function builder(plan: Plan) {
    async function settle(): Promise<Envelope<Row[]>> {
      if (plan.action !== 'select' && !plan.returning) {
        const result = await run<Row[]>(buildStatement(plan));
        return { data: result.error ? null : [], error: result.error };
      }
      const result = await run<Row[]>(buildStatement(plan));
      if (result.error) return { data: null, error: result.error };
      if (plan.count) {
        const first = (result.data ?? [])[0] as { count?: number } | undefined;
        return { data: null, error: null, count: first?.count ?? 0 };
      }
      return { data: result.data ?? [], error: null };
    }

    const chain = {
      select(columns = '*', options?: { count?: 'exact'; head?: boolean }) {
        if (plan.action === 'select') {
          return builder({
            ...plan,
            columns,
            count: options?.count === 'exact',
            head: options?.head === true,
          });
        }
        // On a write, `.select()` is PostgREST's RETURNING clause.
        return builder({ ...plan, returning: columns });
      },
      eq(column: string, value: unknown) {
        return builder({ ...plan, filters: [...plan.filters, { column, operator: 'eq', value }] });
      },
      gte(column: string, value: unknown) {
        return builder({ ...plan, filters: [...plan.filters, { column, operator: 'gte', value }] });
      },
      is(column: string, value: null) {
        if (value !== null) throw new Error('the double supports `.is(column, null)` only');
        return builder({ ...plan, filters: [...plan.filters, { column, operator: 'isNull' }] });
      },
      order(column: string, options?: { ascending?: boolean }) {
        return builder({
          ...plan,
          order: { column, ascending: options?.ascending !== false },
        });
      },
      limit(count: number) {
        if (!Number.isInteger(count) || count < 0) throw new Error('limit must be a whole number');
        return builder({ ...plan, limit: count });
      },
      async maybeSingle(): Promise<Envelope<Row | null>> {
        const result = await settle();
        if (result.error) return { data: null, error: result.error };
        const rows = result.data ?? [];
        if (rows.length > 1) {
          return { data: null, error: { code: 'PGRST116', message: 'more than one row returned' } };
        }
        return { data: rows[0] ?? null, error: null };
      },
      async single(): Promise<Envelope<Row>> {
        const result = await chain.maybeSingle();
        if (result.error) return { data: null, error: result.error };
        if (!result.data) {
          return { data: null, error: { code: 'PGRST116', message: 'no rows returned' } };
        }
        return { data: result.data, error: null };
      },
      then<TResult1 = Envelope<Row[]>, TResult2 = never>(
        onfulfilled?: ((value: Envelope<Row[]>) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return settle().then(onfulfilled, onrejected);
      },
    };

    return chain;
  }

  const client = {
    from(table: string) {
      const base: Plan = {
        table,
        action: 'select',
        columns: '*',
        returning: null,
        values: [],
        onConflict: null,
        filters: [],
        order: null,
        limit: null,
        head: false,
        count: false,
      };
      return {
        select: (columns?: string, options?: { count?: 'exact'; head?: boolean }) =>
          builder(base).select(columns, options),
        insert: (values: Row | Row[]) =>
          builder({ ...base, action: 'insert', values: Array.isArray(values) ? values : [values] }),
        update: (values: Row) => builder({ ...base, action: 'update', values: [values] }),
        upsert: (values: Row, options: { onConflict: string }) =>
          builder({
            ...base,
            action: 'upsert',
            values: [values],
            onConflict: options.onConflict,
          }),
      };
    },

    async rpc(name: string, params: Record<string, unknown> = {}): Promise<Envelope<unknown>> {
      const names = Object.keys(params);
      const args = names.map((argument, index) => `${quote(argument)} => $${index + 1}`);
      const statement: RecordedStatement = {
        sql: `select * from public.${quote(name)}(${args.join(', ')})`,
        params: names.map((argument) => params[argument] ?? null),
      };
      const result = await run<Row[]>(statement);
      if (result.error) return { data: null, error: result.error };

      const rows = result.data ?? [];
      const first = rows[0];
      // A set-returning function projects the table's own columns, so its result
      // is the row list PostgREST would return. A scalar function projects one
      // column named after itself, and PostgREST returns that value alone.
      if (first && Object.keys(first).length === 1 && name in first) {
        return { data: first[name] ?? null, error: null };
      }
      return { data: rows, error: null };
    },
  };

  return {
    client: client as unknown as SupabaseClient,
    statements,
    failNext(needle: string, code = '57014') {
      forced.push({ needle, code });
    },
  };
}
