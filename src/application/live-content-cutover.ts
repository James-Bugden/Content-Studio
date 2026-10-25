import 'server-only';
import type { Services } from './container';
import type { ServerEnv } from '@/lib/env';
import type { ServiceAccountTokens } from '@/integrations/google/service-account';
import { GoogleSheetTransport } from '@/integrations/google/google-sheet';
import { GooglePrivateBackupFolder } from '@/integrations/google/private-backup-folder';
import { SupabaseContentDb } from '@/integrations/supabase/content-db';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';
import { ContentCutoverStore } from '@/integrations/supabase/content-cutover-store';
import { ContentReadCutoverRepository } from './content-read-cutover';
import { ContentExporter, ContentWriteCutover } from './content-export';
import { databaseBodyRepository, MarkdownExporter } from './markdown-export';
import { compareContent, PARITY_COLLECTIONS } from './content-parity';
import { createContentBackup } from './content-backup';
import { AppError } from '@/domain/errors';

export type LiveCutoverOps = {
  execute(action: 'measure' | 'backup' | 'rollback' | 'activate-read' | 'activate-db', operationId: string): Promise<unknown>;
  'activate-read'(): Promise<unknown>;
  'activate-db'(): Promise<unknown>;
  status(): Promise<{ blocking?: string }>;
  measure(): Promise<unknown>;
  backup(): Promise<{ status: string; manifestHash: string; verifiedAt: number }>;
  rollback(): Promise<unknown>;
};

/** Flip admission checks this exact SHA; ongoing DB authority checks a durable
 * schema/cutover contract epoch. Owner recovery is independent of measurements. */
export function composeLiveCutover(services: Services, env: ServerEnv, tokens: ServiceAccountTokens) {
  const mode = env.CS_CONTENT_STORE;
  const build = env.VERCEL_GIT_COMMIT_SHA ?? env.CS_COMMIT_SHA ?? '';
  if (!/^[a-f0-9]{40}$/.test(build)) throw new AppError('CONFIG_MISSING', { reason: 'cutover_build_identity' });
  const options = { url: env.SUPABASE_READ_MODEL_URL!, serviceKey: env.SUPABASE_READ_MODEL_SERVICE_KEY! };
  const store = new ContentCutoverStore(options, build, mode === 'db' ? 'db' : 'db-read');
  const db = new SupabaseContentDb({ ...options, authorizeWrite: async name => {
    if (mode === 'db-read' && name !== 'write_through') throw new AppError('FORBIDDEN');
    if (mode === 'db-shadow') throw new AppError('FORBIDDEN');
    if (mode === 'db' && !['apply_patch', 'insert_queue_idea', 'restore_markdown_link', 'complete_markdown_export'].includes(name)) throw new AppError('FORBIDDEN');
    if (mode === 'db' && env.CS_CONTENT_WRITE_ENABLED !== 'true' && name !== 'complete_markdown_export') throw new AppError('FORBIDDEN');
    if (name === 'complete_markdown_export' && mode === 'db') await store.assertRecovery();
    else await store.assertGate(mode === 'db' ? 'db' : 'db-read', true);
  } });
  const dbRepo = new SupabaseContentRepository(db);
  const sheetAuthority = services.repo;
  const exporter = new ContentExporter(db, new GoogleSheetTransport(env.CS_SHEET_ID!, tokens, env.GOOGLE_WRITE_ENABLED === 'true'), store.exportJournal);
  let markdownToken: string | undefined;
  const markdown = new MarkdownExporter(dbRepo, services.drive, db, run => store.exclusive('markdown-export', async (_, token) => {
    markdownToken = token;
    try { await run(); } finally { markdownToken = undefined; }
  }), () => store.fence('markdown-export', markdownToken));
  // Preparation runs in shadow/read mode so backup and exact rollback evidence
  // exist BEFORE admitting DB authority. Neither changes the configured mode.
  services.liveCutover = {
    execute: (action, operationId) => store.operation(action, operationId, () => services.liveCutover![action]()),
    'activate-read': () => store.activate('db-read'),
    'activate-db': () => store.activate('db'),
    async status() { await store.assertGate(mode === 'db' ? 'db' : 'db-read'); return { blocking: store.blocking }; },
    async measure() {
      if (mode === 'db') throw new AppError('FORBIDDEN', { reason: 'imports_disabled_in_db_mode' });
      await services.contentParity!.prepare();
      const importId = await db.latestImportId();
      if (!importId) throw new AppError('FORBIDDEN');
      const reader = new SupabaseContentRepository(db, 'db-read');
      const methods = ['listLibrary', 'listQueue', 'listReadyQueue', 'listSchedule', 'queueSummary', 'workflowSettings'] as const;
      const samples: Record<string, ReturnType<typeof compareContent>> = {};
      for (let i = 0; i < methods.length; i++) {
        const method = methods[i]!, collection = PARITY_COLLECTIONS[i]!;
        // Both methods return complete sets; no random sample or cached Sheet.
        const expected = await services.importRepo![method](), actual = await reader[method]();
        const sample = compareContent(collection, expected, actual, Date.now(), services.contentParity!.lastImport);
        await services.contentParity!.record(sample);
        samples[collection] = sample;
      }
      await store.record('parity', importId, { coverage: 'all-rows', samples });
      await store.assertFlip('db-read');
      return { coverage: 'all-rows', samples, build };
    },
    async backup() {
      await store.assertRecovery();
      if (env.GOOGLE_WRITE_ENABLED !== 'true') throw new AppError('FORBIDDEN', { reason: 'google_writes_disabled' });
      if (!services.contentBackup) throw new AppError('CONFIG_MISSING', { reason: 'private_backup_folder' });
      return store.exclusive('backup', async (state, token) => {
        if (state && typeof state === 'object') Object.assign(store.backupJournal, state);
        const importId = await db.latestImportId();
        if (!importId) throw new AppError('FORBIDDEN');
        const folder = services.contentBackup!.folder;
        const result = await createContentBackup(store, { assertPrivate: () => folder.assertPrivate(), read: id => folder.read(id),
          create: async (...args) => { await store.fence('backup', token); return folder.create(...args); } }, store.backupJournal);
        await store.record('backup', importId, { manifestHash: result.manifestHash, verifiedAt: result.verifiedAt });
        return { status: 'verified', manifestHash: result.manifestHash, verifiedAt: result.verifiedAt };
      });
    },
    async rollback() {
      if (mode === 'db-shadow') throw new AppError('FORBIDDEN', { reason: 'rollback_store_mode' });
      if (env.CS_CONTENT_WRITE_ENABLED !== 'false') throw new AppError('FORBIDDEN', { reason: 'freeze_every_instance_first' });
      await store.assertRecovery();
      const importId = await db.latestImportId();
      if (!importId) throw new AppError('FORBIDDEN');
      const cutover = services.contentCutover ?? new ContentWriteCutover(dbRepo, exporter, () => markdown.verifyRollback());
      const result = await cutover.rollbackToSheet(async () => {
        // Configuration changes are coordinator-only. This callback records
        // readiness; it never lies that a deployment flag was actually flipped.
      });
      await store.record('rehearsal', importId, result.parity);
      return { readyToFlip: 'sheet', writesDisabled: true, parity: result.parity, build };
    },
  };
  if (env.CS_CONTENT_BACKUP_FOLDER_ID) services.contentBackup = { source: store,
    folder: new GooglePrivateBackupFolder(tokens, env.CS_CONTENT_BACKUP_FOLDER_ID, fetch, [env.GOOGLE_SERVICE_ACCOUNT_EMAIL!, env.CS_OWNER_EMAIL ?? '']), journal: store.backupJournal, prepare: () => store.refreshBackup() };
  if (mode === 'db-read') services.repo = store.guard(new ContentReadCutoverRepository(sheetAuthority, db), 'db-read');
  if (mode === 'db') {
    services.contentCutover = new ContentWriteCutover(store.guard(dbRepo, 'db'), exporter, () => markdown.verifyRollback());
    if (env.CS_CONTENT_WRITE_ENABLED !== 'true') void services.contentCutover.disableWrites();
    services.repo = databaseBodyRepository(services.contentCutover.repo);
    services.markdownExport = markdown;
  }
}
