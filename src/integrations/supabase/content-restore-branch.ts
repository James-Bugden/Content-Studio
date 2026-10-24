import 'server-only';
import { BACKUP_TABLES, type ContentBackupSnapshot, type ContentRestoreBranch } from '@/application/content-backup';
import { CONTENT_STUDIO_SCHEMA_VERSION } from './content-schema';
import { AppError } from '@/domain/errors';

export interface ContentBranchQuery {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}
/** Explicit branch-administrator connection. No live implementation or URL is
 * supplied in this build. Restores need sequence UPDATE, which the runtime
 * service role intentionally lacks; never broaden runtime grants for a drill. */
export interface IsolatedContentBranchSql {
  readonly environment: 'isolated-restore-branch';
  transaction<T>(run: (query: ContentBranchQuery) => Promise<T>): Promise<T>;
}
export async function readContentBackupSnapshot(query: ContentBranchQuery): Promise<ContentBackupSnapshot> {
  const result = {} as ContentBackupSnapshot;
  for (const table of BACKUP_TABLES) result[table] = (await query.query<{ row: Record<string, unknown> }>(`select to_jsonb(t) as row from public.content_studio_${table} t`)).rows.map(r => r.row);
  return result;
}
export class SqlContentRestoreBranch implements ContentRestoreBranch {
  readonly purpose = 'isolated-restore-branch' as const;
  constructor(private readonly sql: IsolatedContentBranchSql) {
    if (sql.environment !== 'isolated-restore-branch') throw new AppError('FORBIDDEN');
  }
  snapshot() { return this.sql.transaction(readContentBackupSnapshot); }
  async restoreEmpty(snapshot: ContentBackupSnapshot, version: number) {
    await this.sql.transaction(async query => {
      const schema = await query.query<{ version: number }>('select version from public.content_studio_schema_version where singleton=true');
      if (version !== CONTENT_STUDIO_SCHEMA_VERSION || schema.rows.length !== 1 || schema.rows[0]!.version !== version) throw new AppError('SCHEMA_DRIFT');
      // Stop other restore attempts for the entire empty-check + insert. The
      // branch must be offline to application writers throughout the drill.
      await query.exec(`lock table ${BACKUP_TABLES.map(t => `public.content_studio_${t}`).join(', ')} in access exclusive mode`);
      for (const table of BACKUP_TABLES) if ((await query.query(`select 1 from public.content_studio_${table} limit 1`)).rows.length) throw new AppError('CONFLICT', { reason: 'restore_branch_not_empty' });
      await query.exec('set constraints all deferred');
      for (const table of BACKUP_TABLES) await query.query(`insert into public.content_studio_${table} select * from jsonb_populate_recordset(null::public.content_studio_${table}, $1::jsonb)`, [JSON.stringify(snapshot[table])]);
      for (const [table, key] of [['row_history', 'history_id'], ['audit_events', 'event_id']]) await query.exec(`select setval(pg_get_serial_sequence('public.content_studio_${table}', '${key}'), coalesce((select max(${key}) from public.content_studio_${table}), 1), exists(select 1 from public.content_studio_${table}))`);
    });
  }
}
