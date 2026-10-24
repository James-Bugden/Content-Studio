// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { imageFilename, TransferImage } from '@/components/image-transfer';

const png = new Blob(['synthetic PNG'], { type: 'image/png' });
let encode: (blob: Blob | null) => void;
const write = vi.fn().mockResolvedValue(undefined);
const share = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => { encode = callback; });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
  Object.defineProperty(navigator, 'share', { configurable: true, value: share });
  vi.stubGlobal('ClipboardItem', class { constructor(public data: Record<string, Blob>) {} });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); write.mockReset().mockResolvedValue(undefined); share.mockReset().mockResolvedValue(undefined); });

async function ready() {
  const img = screen.getByRole('img');
  Object.defineProperties(img, { naturalWidth: { value: 1080 }, naturalHeight: { value: 1350 } });
  fireEvent.load(img);
  encode(png);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Download' }).hasAttribute('disabled')).toBe(false));
  return img;
}

it('sanitises filenames without including paths, URLs or markup', () => {
  expect(imageFilename('A synthetic post')).toBe('a-synthetic-post-1.png');
  expect(imageFilename('')).toBe('post-1.png');
  expect(imageFilename('../<script>')).toBe('script-1.png');
});

it('prepares a cached image after mount even when no load event arrives', async () => {
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(1080);
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(1350);
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
  render(<TransferImage src="/api/library/SYN-L012/render" alt="Synthetic graphic" />);
  encode(png);
  await waitFor(() => expect(screen.getByRole('img').parentElement?.getAttribute('draggable')).toBe('true'));
});

it('waits for preparation, then clears native drag data and adds only a PNG file', async () => {
  render(<TransferImage src="/api/library/SYN-L012/render" filename="Synthetic lesson" alt="Synthetic graphic" />);
  expect(screen.getByRole('img').parentElement?.getAttribute('draggable')).toBe('false');
  const img = await ready();
  const data = { clearData: vi.fn(), items: { clear: vi.fn(), add: vi.fn().mockReturnValue({ kind: 'file' }) }, effectAllowed: '' };
  fireEvent.dragStart(img, { dataTransfer: data });
  expect(data.clearData).toHaveBeenCalledOnce();
  expect(data.items.clear).toHaveBeenCalledOnce();
  const file = data.items.add.mock.calls[0]![0] as File;
  expect(file).toBeInstanceOf(File);
  expect(file.name).toBe('synthetic-lesson-1.png');
  expect(file.type).toBe('image/png');
  expect(data.effectAllowed).toBe('copy');
  data.items.add.mockImplementation(() => { throw new Error(); });
  expect(fireEvent.dragStart(img, { dataTransfer: data })).toBe(false);
  expect(screen.getByRole('status').textContent).toContain('Drag is unavailable');
});

it('copies and shares only the PNG; denied clipboard falls back with honest feedback', async () => {
  render(<TransferImage src="/api/library/SYN-L012/render" alt="Synthetic graphic" />);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Copy image' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Image copied'));
  expect(Object.keys(write.mock.calls[0]![0][0].data)).toEqual(['image/png']);
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  await waitFor(() => expect(share).toHaveBeenCalledOnce());
  expect(Object.keys(share.mock.calls[0]![0])).toEqual(['files']);
  expect(share.mock.calls[0]![0].files[0].type).toBe('image/png');
  write.mockRejectedValueOnce(new Error('denied'));
  fireEvent.click(screen.getByRole('button', { name: 'Copy image' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Use Download instead'));
});

it('hides Share when files cannot be shared and disables unsupported clipboard', async () => {
  Object.defineProperty(navigator, 'canShare', { value: () => false });
  Object.defineProperty(navigator, 'clipboard', { value: undefined });
  render(<TransferImage src="/api/library/SYN-L012/render" alt="Synthetic graphic" />);
  await ready();
  expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Copy image' }).hasAttribute('disabled')).toBe(true);
});

it('invalidates the old file immediately on a source change; failed encoding stays disabled', async () => {
  const view = render(<TransferImage src="/api/library/SYN-L012/render?m=first" alt="Synthetic graphic" />);
  await ready();
  view.rerender(<TransferImage src="/api/library/SYN-L012/render?m=second" alt="Synthetic graphic" />);
  expect(screen.getByRole('img').parentElement?.getAttribute('draggable')).toBe('false');
  const img = screen.getByRole('img');
  Object.defineProperties(img, { naturalWidth: { value: 1080 }, naturalHeight: { value: 1080 } });
  fireEvent.load(img);
  encode(null);
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('could not be prepared'));
  expect(screen.getByRole('button', { name: 'Download' }).hasAttribute('disabled')).toBe(true);
});
