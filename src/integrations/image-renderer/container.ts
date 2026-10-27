import 'server-only';
import { serverEnv } from '@/lib/env';
import { FakeImageRenderer } from './fake';
import { HttpImageRenderer } from './http';
import type { ImageRenderer } from './port';

export function getImageRenderer(): ImageRenderer {
  const env = serverEnv();
  if (env.CS_DATA_MODE === 'fake') return new FakeImageRenderer();
  return new HttpImageRenderer(env.APP_BASE_URL ? new URL('/api/render-image', env.APP_BASE_URL).href : '', env.IMAGE_RENDERER_SECRET ?? '');
}
