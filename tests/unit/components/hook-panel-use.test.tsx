// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HookPanel } from '@/components/editor/hook-panel';
import { fingerprint } from '@/domain/hash';

const text = 'Old hook\n\nBody line.';
const scores = { specificity: 2, tension: 1, audienceFit: 2, credibility: 1, valuePromise: 2 };
const alt = (n: number) => ({ template: `T${n}`, framework: 'F', hookType: 'H', text: `Synthetic hook ${n}`, scores, total: 8 });
const urls: string[] = [];

afterEach(() => { cleanup(); vi.unstubAllGlobals(); urls.length = 0; });

function setup(onUseHook?: (hook: string) => void, dirty = false) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(String(url));
    return Response.json({ ok: true, proposal: { id: 'p1', draftHash: fingerprint(text), currentHook: 'Old hook', platform: 'LinkedIn', alternatives: [alt(1), alt(2), alt(3)] } });
  }));
  render(<HookPanel libraryId="SYN-L001" platform="LinkedIn" currentHook="Old hook" text={text} dirty={dirty} markdownOk sheetRevision={'a'.repeat(16)} sectionHash={'b'.repeat(16)} canEdit onChanged={() => {}} onUseHook={onUseHook} contentStore="database" />);
}

describe('hook review panel Use this hook (#251)', () => {
  it('puts the option in the editor and never calls the server select', async () => {
    const used: string[] = [];
    setup((hook) => used.push(hook));
    fireEvent.click(screen.getByRole('button', { name: 'Suggest three hooks' }));
    await screen.findByText('Synthetic hook 2');
    fireEvent.click(screen.getAllByRole('radio')[2]!);
    fireEvent.click(screen.getByRole('button', { name: 'Use this hook' }));
    await waitFor(() => expect(used).toEqual(['Synthetic hook 2']));
    expect(urls.some((u) => u.includes('/hooks/select'))).toBe(false);
    expect(screen.getByText(/Save to keep it, or Undo/)).toBeTruthy();
  });

  it('is not blocked by unsaved draft changes, since it edits the draft itself', async () => {
    setup(() => {}, true);
    fireEvent.click(screen.getByRole('button', { name: 'Suggest three hooks' }));
    await screen.findByText('Synthetic hook 1');
    fireEvent.click(screen.getAllByRole('radio')[1]!);
    expect((screen.getByRole('button', { name: 'Use this hook' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
