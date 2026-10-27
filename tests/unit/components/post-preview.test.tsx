// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { useState } from 'react';
import { SaveAs } from '@/components/editor/save-as';
import { PlatformPreview } from '@/components/panel/platform-preview';
import type { SaveSelection } from '@/domain/post-versions';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('keeps exact text, expands the LinkedIn reading fold and distinguishes platform brands', () => {
  const exact = 'Synthetic long post 🙂\n\n'.repeat(20);
  render(<PlatformPreview platform="LinkedIn" text={exact} thumb={null} />);
  const article = screen.getByRole('article', { name: 'Preview on LinkedIn' });
  expect(article.querySelector('p[lang]')!.textContent).toBe(exact);
  expect(article.querySelector('svg path[fill="#0A66C2"]')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '…see more' }));
  expect(screen.getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe('true');
});

it('a Chinese response keeps platform selections changed during generation', async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  function Demo() {
    const [selection, setSelection] = useState<SaveSelection>({ platforms: ['LinkedIn'] });
    return <SaveAs libraryId="SYN-L001" text="Synthetic English" value={selection} onChange={setSelection} canEdit />;
  }
  render(<Demo />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Chinese from English' }));
  fireEvent.click(screen.getByRole('button', { name: 'Generate Chinese' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'X' }));
  await act(async () => finish(Response.json({ ok: true, content: '繁體中文草稿。' })));
  expect((screen.getByRole('checkbox', { name: 'X' }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('Chinese review draft') as HTMLTextAreaElement).value).toBe('繁體中文草稿。');
});
