// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { imageFilename, TransferImage } from '@/components/image-transfer';
import { PostThumb } from '@/components/panel/post-thumb';

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
  expect(imageFilename('求職技巧', 'SYN-L012')).toBe('syn-l012-1.png');
  expect(imageFilename('求職技巧', 'SYN-L013')).toBe('syn-l013-1.png');
  expect(imageFilename('Career 求職', 'SYN-L014')).toBe('syn-l014-1.png');
  expect(imageFilename('', 'SYN-L015')).toBe('syn-l015-1.png');
});

it('prepares a cached image after mount even when no load event arrives', async () => {
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(1080);
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(1350);
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
  render(<StrictMode><TransferImage src="/api/library/SYN-L012/render" alt="Synthetic graphic" /></StrictMode>);
  expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledOnce();
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
  const status = screen.getByRole('status');
  expect(status.textContent).toContain('Clipboard images are unavailable in this browser. Use Download.');
  expect(screen.getByRole('button', { name: 'Copy image' }).getAttribute('aria-describedby')).toBe(status.id);
});

it('ignores a stale preparation that finishes after the newer preparation on the same mounted image', async () => {
  render(<TransferImage src="/api/library/SYN-L012/render" alt="Synthetic graphic" />);
  const img = screen.getByRole('img');
  Object.defineProperties(img, { naturalWidth: { value: 1080 }, naturalHeight: { value: 1080 } });
  fireEvent.load(img);
  const stale = encode;
  fireEvent.load(img);
  const latest = new Blob(['newer, distinct image bytes'], { type: 'image/png' });
  await act(async () => encode(latest));
  await act(async () => stale(png));
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  await waitFor(() => expect(share).toHaveBeenCalledOnce());
  expect(share.mock.calls[0]![0].files[0].size).toBe(latest.size);
});

it('leaves the polite status unchanged when the user cancels Share, but reports other failures', async () => {
  render(<TransferImage src="/api/library/SYN-L012/render" alt="Synthetic graphic" />);
  await ready();
  const status = screen.getByRole('status').textContent;
  share.mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Share' })));
  expect(share).toHaveBeenCalledOnce();
  expect(screen.getByRole('status').textContent).toBe(status);
  share.mockRejectedValueOnce(new Error('unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Image could not be shared'));
});

it.each(['pointerEnter', 'touchStart', 'click'] as const)('prepares a thumbnail only on %s, once, with its slug', async event => {
  const view = render(<PostThumb thumb={{ src: '/api/library/SYN-L012/render', filename: 'A synthetic lesson', contentId: 'SYN-L012', label: 'Approved', tone: 'done' }} />);
  const img = view.container.querySelector('img')!;
  Object.defineProperties(img, { complete: { value: true }, naturalWidth: { value: 1080 }, naturalHeight: { value: 1080 } });
  fireEvent.load(img);
  expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
  expect(img.parentElement?.getAttribute('draggable')).toBe('false');
  fireEvent[event](img.parentElement!);
  fireEvent[event](img.parentElement!);
  expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledOnce();
  await act(async () => encode(png));
  expect(img.parentElement?.getAttribute('draggable')).toBe('true');
  fireEvent[event](img.parentElement!);
  expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledOnce();
  const add = vi.fn().mockReturnValue({ kind: 'file' });
  fireEvent.dragStart(img, { dataTransfer: { clearData: vi.fn(), items: { clear: vi.fn(), add } } });
  expect(add.mock.calls[0]![0].name).toBe('a-synthetic-lesson-1.png');
  expect(screen.queryByRole('group', { name: 'Image actions' })).toBeNull();
  view.rerender(<PostThumb thumb={{ src: '/api/library/SYN-L013/render', filename: '求職技巧', contentId: 'SYN-L013', label: 'Approved', tone: 'done' }} />);
  expect(view.container.querySelector('img')!.parentElement?.getAttribute('draggable')).toBe('false');
});

it('prepares on load after early thumbnail intent, and ignores completion after unmount', async () => {
  const canShare = vi.spyOn(navigator, 'canShare');
  const view = render(<TransferImage actions={false} preparation="interaction" src="/api/library/SYN-L012/render" alt="Synthetic graphic" />);
  const img = view.container.querySelector('img')!;
  fireEvent.touchStart(img.parentElement!);
  expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
  Object.defineProperties(img, { naturalWidth: { value: 1080 }, naturalHeight: { value: 1080 } });
  fireEvent.load(img);
  expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledOnce();
  const canvas = vi.mocked(HTMLCanvasElement.prototype.toBlob).mock.contexts[0] as HTMLCanvasElement;
  view.unmount();
  await act(async () => encode(png));
  expect(canShare).not.toHaveBeenCalled();
  expect(canvas.width).toBe(0);
  expect(canvas.height).toBe(0);
  expect(img.parentElement?.getAttribute('draggable')).toBe('false');
});

it('display-only previews never encode, drag or show actions, including on interaction', () => {
  render(<TransferImage actions={false} src="data:image/svg+xml,synthetic" alt="Unsaved or duplicate preview" />);
  const img = screen.getByRole('img');
  Object.defineProperties(img, { complete: { value: true }, naturalWidth: { value: 1080 }, naturalHeight: { value: 1080 } });
  fireEvent.load(img);
  fireEvent.pointerEnter(img.parentElement!);
  fireEvent.touchStart(img.parentElement!);
  fireEvent.focus(img.parentElement!);
  fireEvent.click(img.parentElement!);
  expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
  expect(img.getAttribute('draggable')).toBe('false');
  expect(img.parentElement?.getAttribute('draggable')).toBe('false');
  expect(screen.queryByRole('group', { name: 'Image actions' })).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
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
