import type { Services } from '@/application/container';
import { serverEnv } from '@/lib/env';
import { composeLiveCutover } from '@/application/live-content-cutover';
import { ServiceAccountTokens } from '@/integrations/google/service-account';
import { GoogleSheetTransport } from '@/integrations/google/google-sheet';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { SupabaseContentRepository } from '@/integrations/supabase/content-repository';
import { ContentExporter, ContentWriteCutover } from '@/application/content-export';
import { databaseBodyRepository, MarkdownExporter } from '@/application/markdown-export';

/** Component harness for retained legacy export/rollback contracts. These
 * adapters are deliberately absent from the production db composition. Current
 * DB-only composition is exercised independently in database-only.test.ts. */
export function legacyCutoverServices(services: Services): Services {
  const env = serverEnv();
  if (env.CS_CONTENT_STORE !== 'db' || services.contentCutover) return services;
  if (services.fakes) {
    const { db, sheet, drive } = services.fakes;
    const exporter = new ContentExporter(db, sheet, { checkpoints: new Map(), issues: new Map(), reports: [] });
    services.contentCutover = new ContentWriteCutover(new SupabaseContentRepository(db), exporter, () => services.markdownExport!.verifyRollback());
    if (env.CS_CONTENT_WRITE_ENABLED === 'false') void services.contentCutover.disableWrites();
    services.repo = databaseBodyRepository(services.contentCutover.repo);
    services.markdownExport = new MarkdownExporter(services.repo, drive, db);
  } else {
    const tokens = new ServiceAccountTokens(env.GOOGLE_SERVICE_ACCOUNT_EMAIL!, env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY!);
    services.repo = new SheetsContentRepository(new GoogleSheetTransport(env.CS_SHEET_ID!, tokens, env.GOOGLE_WRITE_ENABLED === 'true'));
    composeLiveCutover(services, env, tokens);
  }
  return services;
}
