import { expect, it, vi } from 'vitest';
import { readSection } from '@/application/markdown-source';
import type { DriveGateway } from '@/application/ports';
import { SheetsContentRepository } from '@/integrations/google/sheets-repository';
import { FakeSheetTransport } from '@/integrations/google/fake-sheet';

it('Markdown rejects unbranded code-shaped values but preserves branded cross-graph errors', async () => {
  const record = await new SheetsContentRepository(new FakeSheetTransport()).getLibrary('SYN-L001');
  vi.resetModules();
  const { AppError } = await import('@/domain/errors');
  for (const [error, code] of [
    [{ code: 'FORBIDDEN' }, 'PROVIDER_UNAVAILABLE'],
    [Object.assign(new Error('Synthetic'), { name: 'AppError', code: 'FORBIDDEN', details: {} }), 'PROVIDER_UNAVAILABLE'],
    [new AppError('FORBIDDEN'), 'FORBIDDEN'],
  ] as const) {
    const drive = { readText: async () => { throw error; } } as unknown as DriveGateway;
    expect(await readSection(drive, record)).toMatchObject({ ok: false, reason: 'provider', code });
  }
});
