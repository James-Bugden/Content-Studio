import 'server-only';
import { AppError } from '@/domain/errors';
import { serverEnv } from '@/lib/env';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { FakeDriveGateway } from '@/integrations/google/fake-drive';
import { GoogleSheetTransport } from '@/integrations/google/google-sheet';
import { GoogleDriveGateway } from '@/integrations/google/google-drive';
import { ServiceAccountTokens } from '@/integrations/google/service-account';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import type { ContentRepository, DriveGateway } from './ports';

/**
 * Composition root. One set of adapters per server process: fakes seeded from
 * synthetic fixtures in `fake` mode, Google adapters in `live` mode. Nothing
 * outside this file decides which implementation runs.
 */
export type Services = {
  mode: 'fake' | 'live';
  repo: ContentRepository;
  drive: DriveGateway;
  /** Fake handles, exposed for e2e fault injection in fake mode only. */
  fakes?: { sheet: FakeSheetTransport; drive: FakeDriveGateway };
};

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
    services = { mode: 'fake', repo: new SheetsContentRepository(sheet), drive, fakes: { sheet, drive } };
    return services;
  }
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || !env.CS_SHEET_ID) {
    throw new AppError('CONFIG_MISSING', { provider: 'sheet' });
  }
  const writable = env.GOOGLE_WRITE_ENABLED === 'true';
  const tokens = new ServiceAccountTokens(env.GOOGLE_SERVICE_ACCOUNT_EMAIL, env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
  services = {
    mode: 'live',
    repo: new SheetsContentRepository(new GoogleSheetTransport(env.CS_SHEET_ID, tokens, writable), { writable }),
    drive: new GoogleDriveGateway(tokens, writable),
  };
  return services;
}

/** Tests and e2e reset only. */
export function resetServices(): void {
  store[KEY] = null;
}
