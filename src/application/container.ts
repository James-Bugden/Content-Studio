import 'server-only';
import { AppError } from '@/domain/errors';
import { serverEnv } from '@/lib/env';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';
import { FakeDriveGateway } from '@/integrations/google/fake-drive';
import { GoogleSheetTransport } from '@/integrations/google/google-sheet';
import { GoogleDriveGateway } from '@/integrations/google/google-drive';
import { ServiceAccountTokens } from '@/integrations/google/service-account';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
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
  /** Fake handles, exposed for e2e fault injection in fake mode only. */
  fakes?: { sheet: FakeSheetTransport; drive: FakeDriveGateway; ai?: FakeAiGateway; typefully?: FakeTypefullyGateway };
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
    services = {
      mode: 'fake',
      repo: new SheetsContentRepository(sheet),
      drive,
      ai,
      typefully,
      fakes: {
        sheet,
        drive,
        ...(ai instanceof FakeAiGateway ? { ai } : {}),
        ...(typefully instanceof FakeTypefullyGateway ? { typefully } : {}),
      },
    };
    return services;
  }
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || !env.CS_SHEET_ID) {
    throw new AppError('CONFIG_MISSING', { provider: 'sheet' });
  }
  const writable = env.GOOGLE_WRITE_ENABLED === 'true';
  const tokens = new ServiceAccountTokens(env.GOOGLE_SERVICE_ACCOUNT_EMAIL, env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
  services = {
    mode: 'live',
    repo: new SheetsContentRepository(new GoogleSheetTransport(env.CS_SHEET_ID, tokens, writable), { writable, readCacheMs: 3000 }),
    drive: new GoogleDriveGateway(tokens, writable, fetch, env.CS_ASSET_FOLDER_ID),
    ai: createAiGateway(env),
    typefully: createTypefullyGateway(env),
  };
  return services;
}

/** Tests and e2e reset only. */
export function resetServices(): void {
  store[KEY] = null;
}
