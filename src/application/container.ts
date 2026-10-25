import 'server-only';
import { databaseBodyRepository, MarkdownExporter } from './markdown-export';
import { ContentReadCutoverRepository } from './content-read-cutover';
import { ContentExporter, ContentWriteCutover } from './content-export';
import { FakePrivateBackupFolder } from '@/integrations/supabase/fake-content-backup';
import type { BackupJournal, ContentBackupSource, PrivateBackupFolder } from './content-backup';
import { contentSheetCacheOptions } from './content-cache';
import { AppError, isAppError } from '@/domain/errors';
import { serverEnv } from '@/lib/env';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { FakeDriveGateway } from '@/integrations/google/fake-drive';
import { GoogleSheetTransport } from '@/integrations/google/google-sheet';
import { GoogleDriveGateway } from '@/integrations/google/google-drive';
import { ServiceAccountTokens } from '@/integrations/google/service-account';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { FakeContentDb } from '@/integrations/supabase/fake-content-db';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';
import { FakeContentImportStore } from '@/integrations/supabase/fake-content-import';
import { SupabaseContentImportStore } from '@/integrations/supabase/content-import-store';
import { SupabaseContentParityJournal } from '@/integrations/supabase/content-parity-journal';
import { ContentParityJournal, shadowContentRepository } from './content-parity';
import type { ContentImportStore } from './content-import';
import { AnthropicAiGateway } from '@/integrations/ai/anthropic-gateway';
import { FakeAiGateway, UnconfiguredAiGateway } from '@/integrations/ai/fake-gateway';
import { FakeTypefullyGateway, UnconfiguredTypefullyGateway } from '@/integrations/typefully/fake-gateway';
import { LiveTypefullyGateway } from '@/integrations/typefully/live-gateway';
import type { AiGateway, ContentRepository, DriveGateway, TypefullyGateway } from './ports';

/**
 * Composition root. One set of adapters per server process: fakes seeded from
 * synthetic fixtures in `fake` mode, Google adapters in `live` mode. Nothing
 * outside this file decides which implementation runs.
 */
export type Services = {
  mode: 'fake' | 'live';
  repo: ContentRepository;
  drive: DriveGateway;
  /** Optional: when AI is down or unconfigured, manual review keeps working. */
  ai: AiGateway;
  /** Optional: when Typefully is down or unconfigured, manual scheduling keeps working. */
  typefully: TypefullyGateway;
  contentImport?: ContentImportStore;
  importRepo?: ContentRepository;
  contentParity?: ContentParityJournal;
  contentCutover?: ContentWriteCutover;
  markdownExport?: MarkdownExporter;
  contentBackup?: { source: ContentBackupSource; folder: PrivateBackupFolder; journal: BackupJournal };
  reconcileRepo?: ContentRepository;
  /** Fake handles, exposed for e2e fault injection in fake mode only. */
  fakes?: { sheet: FakeSheetTransport; db: FakeContentDb; drive: FakeDriveGateway; ai?: FakeAiGateway; typefully?: FakeTypefullyGateway };
};

/**
 * AI adapter choice: the deterministic fake only in fake data mode; Anthropic
 * when explicitly selected and keyed; otherwise a gateway that reports
 * not_configured and returns CONFIG_MISSING. Live data never silently runs on the
 * fake model, because its proposals would look real.
 */
export function createAiGateway(env: ReturnType<typeof serverEnv>): AiGateway {
  if (env.CS_DATA_MODE === 'fake') return new FakeAiGateway();
  if (env.AI_PROVIDER === 'anthropic' && env.AI_API_KEY) {
    return new AnthropicAiGateway({ apiKey: env.AI_API_KEY, ...(env.AI_MODEL ? { model: env.AI_MODEL } : {}) });
  }
  return new UnconfiguredAiGateway();
}

/**
 * Typefully adapter choice: the synthetic fake only in fake data mode; the live
 * API when a key and social set are configured; otherwise a gateway that reports
 * not_configured and returns CONFIG_MISSING. Live data never reaches the fake.
 */
export function createTypefullyGateway(env: ReturnType<typeof serverEnv>): TypefullyGateway {
  if (env.CS_DATA_MODE === 'fake') return new FakeTypefullyGateway();
  if (env.TYPEFULLY_API_KEY && env.TYPEFULLY_SOCIAL_SET_ID) {
    return new LiveTypefullyGateway({ apiKey: env.TYPEFULLY_API_KEY, socialSetId: env.TYPEFULLY_SOCIAL_SET_ID });
  }
  return new UnconfiguredTypefullyGateway();
}

/**
 * Held on globalThis, not in a module variable: Next loads pages and route
 * handlers as separate module graphs, and in fake mode two graphs would each get
 * their own in-memory Sheet, so a write through an API route would be invisible
 * to the page that reads it.
 */
const KEY = Symbol.for('content-studio.services');
const store = globalThis as unknown as Record<symbol, Services | null | undefined>;

export function getServices(): Services {
  const existing = store[KEY];
  if (existing) return existing;
  const services = build();
  store[KEY] = services;
  return services;
}

function build(): Services {
  let services: Services;
  const env = serverEnv();
  if (env.CS_DATA_MODE === 'fake') {
    const sheet = new FakeSheetTransport();
    const drive = new FakeDriveGateway();
    const ai = createAiGateway(env);
    const typefully = createTypefullyGateway(env);
    const db = new FakeContentDb();
    const sheetRepo = new SheetsContentRepository(sheet, { writable: true, ...contentSheetCacheOptions(env.CS_CONTENT_STORE, 'fake') });
    services = {
      mode: 'fake',
      repo: env.CS_CONTENT_STORE === 'db-read' ? new ContentReadCutoverRepository(sheetRepo, db)
        : env.CS_CONTENT_STORE === 'db' ? new SupabaseContentRepository(db) : sheetRepo,
      drive,
      ai,
      typefully,
      fakes: {
        sheet,
        db,
        drive,
        ...(ai instanceof FakeAiGateway ? { ai } : {}),
        ...(typefully instanceof FakeTypefullyGateway ? { typefully } : {}),
      },
    };
    if (env.CS_CONTENT_STORE === 'db') {
      const exporter = new ContentExporter(db, sheet, { checkpoints: new Map(), issues: new Map(), reports: [] });
      services.contentCutover = new ContentWriteCutover(services.repo, exporter, () => services.markdownExport!.verifyRollback());
      if (env.CS_CONTENT_WRITE_ENABLED === 'false') void services.contentCutover.disableWrites();
      services.repo = databaseBodyRepository(services.contentCutover.repo);
      services.markdownExport = new MarkdownExporter(services.repo, drive, db);
      services.contentBackup = { source: { snapshot: () => db.backupSnapshot() }, folder: new FakePrivateBackupFolder(), journal: { lastVerified: null, failureSince: null } };
    }
    if (env.CS_CONTENT_STORE === 'db-read') {
      services.contentImport = new FakeContentImportStore(undefined, db);
      services.importRepo = new SheetsContentRepository(sheet);
      services.contentParity = new ContentParityJournal();
    }
    if (env.CS_CONTENT_STORE === 'db-shadow') {
      const contentImport = new FakeContentImportStore();
      const contentParity = new ContentParityJournal();
      // Resolve the reader for each call: a successful import replaces the fake's snapshot atomically.
      const db = new Proxy({} as ContentRepository, { get: (_, property) => (...args: unknown[]) => {
        const repository = new SupabaseContentRepository(contentImport.db, 'db-read');
        return Reflect.get(repository, property).apply(repository, args);
      } });
      const sheetRepo = services.repo;
      services.repo = shadowContentRepository(sheetRepo, db, contentParity);
      services.reconcileRepo = shadowContentRepository(sheetRepo, db, contentParity, () => true);
      services.contentImport = contentImport;
      services.contentParity = contentParity;
    }
    return services;
  }
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || !env.CS_SHEET_ID) {
    throw new AppError('CONFIG_MISSING', { provider: 'sheet' });
  }
  const writable = env.GOOGLE_WRITE_ENABLED === 'true';
  const tokens = new ServiceAccountTokens(env.GOOGLE_SERVICE_ACCOUNT_EMAIL, env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
  services = {
    mode: 'live',
    // CS-053: the Library and readiness tabs stay cached for a minute per server
    // instance, so bulk editor opens do not re-read the Sheet. Writes clear the
    // cache and every mutation re-reads fresh against the expected revision, so a
    // stale display can be refused but never written over.
    repo: new SheetsContentRepository(new GoogleSheetTransport(env.CS_SHEET_ID, tokens, writable), { writable, ...contentSheetCacheOptions(env.CS_CONTENT_STORE, 'live') }),
    drive: new GoogleDriveGateway(tokens, writable, fetch, env.CS_ASSET_FOLDER_ID),
    ai: createAiGateway(env),
    typefully: createTypefullyGateway(env),
  };
  if (env.CS_CONTENT_STORE === 'db-shadow') {
    const options = { url: env.SUPABASE_READ_MODEL_URL ?? '', serviceKey: env.SUPABASE_READ_MODEL_SERVICE_KEY ?? '' };
    try {
      const contentImport = new SupabaseContentImportStore(options);
      const parity = new SupabaseContentParityJournal(options);
      const sheetRepo = services.repo;
      const dbRepo = new SupabaseContentRepository(contentImport.db, 'db-read');
      // Scheduled capture must not reuse a display cache warmed by an earlier
      // request. This read-only repository adds reads only during explicit import.
      services.importRepo = new SheetsContentRepository(new GoogleSheetTransport(env.CS_SHEET_ID, tokens, false), { writable: false });
      services.repo = shadowContentRepository(sheetRepo, dbRepo, parity);
      services.reconcileRepo = shadowContentRepository(sheetRepo, dbRepo, parity, () => true);
      services.contentImport = contentImport;
      services.contentParity = parity;
    } catch (error) {
      if (!isAppError(error) || error.code !== 'CONFIG_MISSING') throw error;
      const parity = new ContentParityJournal();
      parity.available = false; parity.gap = 'CONFIG_MISSING';
      services.contentParity = parity;
    }
  }
  return services;
}

/** Tests and e2e reset only. */
export function resetServices(): void {
  store[KEY] = null;
}
