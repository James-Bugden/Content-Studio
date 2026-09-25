/**
 * The narrowest database surface retrieval and the embedding worker need.
 *
 * Neither module opens a connection or knows about Supabase. They are handed a
 * runner, which is satisfied by a PostgREST-free `pg`-style client, by a PGlite
 * transaction in the verification harness, and by a request-scoped Supabase
 * connection in production. Keeping the surface to one method is what makes the
 * worker runnable from a script and the search runnable inside a test
 * transaction without either one growing a second code path.
 */
export interface SqlResult<T> {
  rows: T[];
}

export interface SqlRunner {
  query<T>(sql: string, params?: unknown[]): Promise<SqlResult<T>>;
}

/** A parameterised SQL fragment and the values its placeholders refer to. */
export interface SqlFragment {
  sql: string;
  params: unknown[];
}

