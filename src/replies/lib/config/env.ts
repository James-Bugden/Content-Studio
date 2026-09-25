import { z } from 'zod';

/** Reply-specific configuration inside the combined application. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

const optionalUrl = z
  .string()
  .trim()
  .refine((value) => value === '' || /^https?:\/\//.test(value), 'must be an absolute http(s) URL')
  .transform((value) => (value === '' ? undefined : value.replace(/\/+$/, '')))
  .optional();

export type ProviderMode = 'fake' | 'live' | 'unconfigured';

export interface PublicConfig {
  appBaseUrl?: string;
  timezone: string;
  authConfigured: boolean;
}

export interface ServerConfig {
  resourceBaseUrl?: string;
  database: {
    configured: boolean;
    url?: string;
    serviceKey?: string;
  };
  generation: {
    mode: ProviderMode;
    provider: string;
    model: string;
    apiKey?: string;
  };
  embedding: {
    mode: ProviderMode;
    provider: string;
    model: string;
    apiKey?: string;
  };
}

export function publicConfig(source: EnvSource = process.env): PublicConfig {
  const appBaseUrl = optionalUrl.parse(source.APP_BASE_URL ?? '');
  return {
    ...(appBaseUrl ? { appBaseUrl } : {}),
    timezone: source.APP_TIMEZONE?.trim() || 'Asia/Taipei',
    authConfigured: Boolean(source.AUTH_SECRET && source.AUTH_GOOGLE_ID && source.AUTH_GOOGLE_SECRET),
  };
}

function providerConfig(
  provider: string | undefined,
  model: string | undefined,
  apiKey: string | undefined,
  defaults: { provider: string; model: string },
): ServerConfig['generation'] {
  const name = (provider ?? '').trim().toLowerCase();
  if (name === 'fake') return { mode: 'fake', provider: 'fake', model: model?.trim() || 'fake' };
  if (name === '' || !apiKey?.trim()) {
    return { mode: 'unconfigured', provider: name || defaults.provider, model: model?.trim() || defaults.model };
  }
  return { mode: 'live', provider: name, model: model?.trim() || defaults.model, apiKey: apiKey.trim() };
}

export function serverConfig(source: EnvSource = process.env): ServerConfig {
  const resourceBaseUrl = optionalUrl.parse(source.RESOURCE_BASE_URL ?? '');
  const url = optionalUrl.parse(source.SUPABASE_READ_MODEL_URL ?? '');
  const serviceKey = source.SUPABASE_READ_MODEL_SERVICE_KEY?.trim() || undefined;
  return {
    ...(resourceBaseUrl ? { resourceBaseUrl } : {}),
    database: {
      configured: Boolean(url && serviceKey),
      ...(url ? { url } : {}),
      ...(serviceKey ? { serviceKey } : {}),
    },
    generation: providerConfig(source.AI_PROVIDER, source.AI_MODEL, source.AI_API_KEY, {
      provider: 'anthropic',
      model: 'claude-sonnet-5',
    }),
    embedding: providerConfig(source.EMBEDDING_PROVIDER, source.EMBEDDING_MODEL, source.EMBEDDING_API_KEY, {
      provider: 'openai',
      model: 'text-embedding-3-small',
    }),
  };
}

/** Names and states only; credentials never reach the browser. */
export function configurationStatus(source: EnvSource = process.env) {
  const pub = publicConfig(source);
  const server = serverConfig(source);
  return {
    auth: pub.authConfigured ? 'configured' : 'missing',
    database: server.database.configured ? 'configured' : 'missing',
    generation: server.generation.mode,
    generation_model: server.generation.mode === 'live' ? server.generation.model : null,
    embedding: server.embedding.mode,
    embedding_model: server.embedding.mode === 'live' ? server.embedding.model : null,
    resource_origin: server.resourceBaseUrl ? 'configured' : 'missing',
    timezone: pub.timezone,
  } as const;
}
