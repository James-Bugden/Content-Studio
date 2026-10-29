// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BankImage } from '@/replies/lib/contracts/api';
import { ApiError } from '@/replies/lib/workspace/client';

const api = vi.hoisted(() => ({
  listImages: vi.fn(),
  uploadImage: vi.fn(),
  updateImage: vi.fn(),
  deleteImage: vi.fn(),
  suggestImageMeta: vi.fn(),
  createImage: vi.fn(),
}));
vi.mock('@/replies/components/admin/adminApi', () => ({ adminApi: api }));
vi.mock('@/components/image-transfer', async () => {
  const { createElement } = await import('react');
  return {
    TransferImage: ({ src, alt }: { src: string; alt?: string }) => createElement('img', { src, alt: alt ?? '' }),
  };
});

import { ImageAdmin } from '@/replies/components/admin/ImageAdmin';

const image = (overrides: Partial<BankImage> = {}): BankImage => ({
  id: '66666666-6666-4666-8666-000000000001',
  version: 3,
  title: 'Example checklist',
  alt_text: 'An example checklist.',
  tags: ['cover letter'],
  origin: 'upload',
  status: 'ready',
  mime_type: 'image/png',
  byte_size: 100,
  sketch: '',
  sketch_approved: false,
  active: true,
  url: '/api/replies/images/66666666-6666-4666-8666-000000000001/file',
  ...overrides,
});

function pngFile(name = 'checklist-final.png', type = 'image/png') {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const file = new File([bytes], name, { type });
  // jsdom's File has no arrayBuffer in every version; the component needs it.
  if (typeof file.arrayBuffer !== 'function') {
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
  }
  return file;
}

const envelope = (code: string, message: string) => ({ code, message, retryable: false, request_id: 'r' }) as never;

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  api.listImages.mockResolvedValue({ images: [image()] });
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

/** The file input behind the drop zone. */
const picker = () => screen.getByLabelText('Image files') as HTMLInputElement;
const zone = () => screen.getByRole('button', { name: /Drop (images here or click to choose|to add)/ });
const textFile = () => {
  const text = new File(['hello'], 'notes.txt', { type: 'text/plain' });
  if (typeof text.arrayBuffer !== 'function') {
    Object.defineProperty(text, 'arrayBuffer', { value: async () => new TextEncoder().encode('hello').buffer });
  }
  return text;
};

describe('the Images admin list', () => {
  it('lists images with their title, alt text and tags, and no bytes', () => {
    render(<ImageAdmin initial={[image()]} />);
    expect(screen.getByText('Example checklist')).toBeTruthy();
    expect(screen.getByText('An example checklist.', { selector: 'p' })).toBeTruthy();
    expect(screen.getByText('cover letter')).toBeTruthy();
    const thumb = screen.getByRole('img', { name: 'An example checklist.' });
    expect(thumb.getAttribute('src')).toMatch(/^\/api\/replies\/images\/.+\/file$/);
  });

  it('says so when the bank is empty', () => {
    render(<ImageAdmin initial={[]} />);
    expect(screen.getByText('No images yet. Drop a file above.')).toBeTruthy();
    expect(screen.queryByText(/Largest upload/)).toBeNull();
  });

  it('marks a created image that is still a sketch', () => {
    render(<ImageAdmin initial={[image({ origin: 'created', status: 'sketch', url: null, sketch_approved: false })]} />);
    expect(screen.getByText('Created')).toBeTruthy();
    expect(screen.getByText('Sketch awaiting approval')).toBeTruthy();
  });
});

describe('adding an image', () => {
  it('refuses a wrong file before uploading anything', async () => {
    render(<ImageAdmin initial={[]} />);
    await userEvent.upload(picker(), textFile(), { applyAccept: false });
    expect(await screen.findByText('Use a PNG, JPG or WebP image.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(api.uploadImage).not.toHaveBeenCalled();
  });

  it('fills the suggestion into editable fields and saves what the owner leaves there', async () => {
    api.suggestImageMeta.mockResolvedValue({ title: 'Cover letter checklist', alt_text: 'A checklist.', tags: ['cover letter', 'checklist'] });
    api.uploadImage.mockResolvedValue({ id: 'new', version: 1, replayed: false });
    render(<ImageAdmin initial={[]} />);
    await userEvent.upload(screen.getByLabelText('Image files'), pngFile());

    await userEvent.type(screen.getByLabelText(/What does it show/), 'a checklist for letters');
    await userEvent.click(screen.getByRole('button', { name: 'Suggest title, alt text and tags' }));
    expect(await screen.findByText('Suggestion added. Edit anything before saving.')).toBeTruthy();
    expect(api.suggestImageMeta).toHaveBeenCalledWith(
      expect.objectContaining({ file_name: 'checklist-final.png', hint: 'a checklist for letters' }),
    );

    const title = screen.getByLabelText('Title') as HTMLInputElement;
    expect(title.value).toBe('Cover letter checklist');
    expect((screen.getByLabelText('Tags') as HTMLInputElement).value).toBe('cover letter, checklist');

    // Editable before saving.
    await userEvent.clear(title);
    await userEvent.type(title, 'My own title');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.uploadImage).toHaveBeenCalledTimes(1));
    const form = api.uploadImage.mock.calls[0]![0] as FormData;
    expect(form.get('title')).toBe('My own title');
    expect(form.get('tags')).toBe('cover letter, checklist');
    expect(form.get('alt_text')).toBe('A checklist.');
    expect(String(form.get('request_key')).length).toBeGreaterThan(8);
    expect(form.get('file')).toBeInstanceOf(File);
  });

  it('does not need the suggestion: the fields can be filled by hand', async () => {
    api.uploadImage.mockResolvedValue({ id: 'new', version: 1, replayed: false });
    render(<ImageAdmin initial={[]} />);
    await userEvent.upload(screen.getByLabelText('Image files'), pngFile());
    await userEvent.clear(screen.getByLabelText('Title'));
    await userEvent.type(screen.getByLabelText('Title'), 'By hand');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.uploadImage).toHaveBeenCalled());
    expect(api.suggestImageMeta).not.toHaveBeenCalled();
  });

  it('says Monthly AI limit reached when the cap refuses the suggestion, and keeps the form', async () => {
    api.suggestImageMeta.mockRejectedValue(new ApiError(429, envelope('monthly_ai_limit_reached', 'Monthly AI limit reached')));
    render(<ImageAdmin initial={[]} />);
    await userEvent.upload(screen.getByLabelText('Image files'), pngFile());
    await userEvent.click(screen.getByRole('button', { name: 'Suggest title, alt text and tags' }));
    expect(await screen.findByText('Monthly AI limit reached')).toBeTruthy();
    // Nothing was lost and saving by hand still works.
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('checklist final');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('reuses one request key when Save is pressed again after a failure', async () => {
    api.uploadImage
      .mockRejectedValueOnce(new ApiError(500, envelope('internal_error', 'Something went wrong.')))
      .mockResolvedValueOnce({ id: 'new', version: 1, replayed: true });
    render(<ImageAdmin initial={[]} />);
    await userEvent.upload(screen.getByLabelText('Image files'), pngFile());
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.uploadImage).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.uploadImage).toHaveBeenCalledTimes(2));
    const first = (api.uploadImage.mock.calls[0]![0] as FormData).get('request_key');
    const second = (api.uploadImage.mock.calls[1]![0] as FormData).get('request_key');
    expect(second).toBe(first);
  });
});

describe('the drop zone', () => {
  it('opens the file picker on click, Enter and Space', async () => {
    render(<ImageAdmin initial={[]} />);
    const click = vi.spyOn(picker(), 'click');
    await userEvent.click(zone());
    expect(click).toHaveBeenCalledTimes(1);
    zone().focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(click).toHaveBeenCalledTimes(3);
  });

  it('is a real multi-file picker limited to PNG, JPG and WebP, and says how to use it', () => {
    render(<ImageAdmin initial={[]} />);
    expect(picker().multiple).toBe(true);
    expect(picker().accept).toBe('image/png,image/jpeg,image/webp');
    expect(screen.getByText('PNG, JPG or WebP, up to 5 MB')).toBeTruthy();
    expect(zone().tabIndex).toBe(0);
  });

  it('highlights on drag over and handles a dropped file', async () => {
    render(<ImageAdmin initial={[]} />);
    fireEvent.dragOver(zone(), { dataTransfer: { files: [] } });
    expect(zone().getAttribute('data-dragging')).toBe('true');
    fireEvent.drop(zone(), { dataTransfer: { files: [pngFile('dropped.png')] } });
    expect(zone().getAttribute('data-dragging')).toBe('false');
    expect(((await screen.findByLabelText('Title')) as HTMLInputElement).value).toBe('dropped');
  });

  it('handles an image pasted from the clipboard anywhere on the page', async () => {
    render(<ImageAdmin initial={[]} />);
    fireEvent.paste(document.body, { clipboardData: { files: [pngFile('pasted.png')] } });
    expect(((await screen.findByLabelText('Title')) as HTMLInputElement).value).toBe('pasted');
  });

  it('ignores a paste that has no image', () => {
    render(<ImageAdmin initial={[]} />);
    fireEvent.paste(document.body, { clipboardData: { files: [textFile()] } });
    expect(screen.queryByLabelText('Title')).toBeNull();
  });

  it('refuses a file over 5 MB with the reason, without uploading it', async () => {
    render(<ImageAdmin initial={[]} />);
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.png', { type: 'image/png' });
    await userEvent.upload(picker(), big);
    expect(await screen.findByText('That image is over 5 MB.')).toBeTruthy();
    expect(api.uploadImage).not.toHaveBeenCalled();
  });

  it('reviews several files one row each, refuses the bad one, and saves the rest with Save all', async () => {
    api.uploadImage.mockResolvedValue({ id: 'new', version: 1, replayed: false });
    render(<ImageAdmin initial={[]} />);
    await userEvent.upload(picker(), [pngFile('first.png'), textFile(), pngFile('second.png')], { applyAccept: false });
    expect(await screen.findByText('Use a PNG, JPG or WebP image.')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByLabelText('Title')).toHaveLength(2));
    expect(screen.getAllByRole('button', { name: 'Skip' })).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: 'Save all' }));
    await waitFor(() => expect(api.uploadImage).toHaveBeenCalledTimes(2));
    const titles = api.uploadImage.mock.calls.map((call) => (call[0] as FormData).get('title'));
    expect(titles).toEqual(['first', 'second']);
    expect(await screen.findByText('Saved 2 images.')).toBeTruthy();
    // The refused row stays until dismissed.
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Use a PNG, JPG or WebP image.')).toBeNull();
  });

  it('skips one file without uploading it', async () => {
    render(<ImageAdmin initial={[]} />);
    await userEvent.upload(picker(), pngFile());
    await userEvent.click(await screen.findByRole('button', { name: 'Skip' }));
    expect(screen.queryByLabelText('Title')).toBeNull();
    expect(api.uploadImage).not.toHaveBeenCalled();
  });
});

describe('Create with AI', () => {
  it('explains itself and opens the create panel', async () => {
    render(<ImageAdmin initial={[]} />);
    expect(screen.getByText('Draft a sketch, approve it, then it renders an image.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Create with AI' }));
    expect(screen.getByRole('button', { name: 'Make a sketch' })).toBeTruthy();
  });

  it('is disabled with the reason when the renderer is not set up', () => {
    render(<ImageAdmin initial={[]} rendererReady={false} />);
    expect((screen.getByRole('button', { name: 'Create with AI' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Set up the image renderer first')).toBeTruthy();
  });
});

describe('editing and deleting', () => {
  it('sends the version the form was loaded with', async () => {
    api.updateImage.mockResolvedValue({ id: 'x', version: 4 });
    render(<ImageAdmin initial={[image()]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const title = screen.getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Renamed');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateImage).toHaveBeenCalled());
    const [id, version, key, changes] = api.updateImage.mock.calls[0]!;
    expect(id).toBe('66666666-6666-4666-8666-000000000001');
    expect(version).toBe(3);
    expect(String(key).length).toBeGreaterThan(8);
    expect(changes).toMatchObject({ title: 'Renamed', tags: ['cover letter'], active: true });
  });

  it('shows a stale-version message rather than overwriting', async () => {
    api.updateImage.mockRejectedValue(new ApiError(409, envelope('version_conflict', 'x')));
    render(<ImageAdmin initial={[image()]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('This changed somewhere else. Reload before saving.')).toBeTruthy();
  });

  it('asks before deleting, and deletes with the version', async () => {
    api.deleteImage.mockResolvedValue({ ok: true });
    api.listImages.mockResolvedValue({ images: [] });
    render(<ImageAdmin initial={[image()]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(api.deleteImage).not.toHaveBeenCalled();
    expect(screen.getByText('Delete this image for good?')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Delete image' }));
    await waitFor(() => expect(api.deleteImage).toHaveBeenCalledTimes(1));
    expect(api.deleteImage.mock.calls[0]![1]).toBe(3);
    expect(await screen.findByText('Deleted.')).toBeTruthy();
    expect(screen.getByText('No images yet. Drop a file above.')).toBeTruthy();
  });

  it('can back out of a delete', async () => {
    render(<ImageAdmin initial={[image()]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.deleteImage).not.toHaveBeenCalled();
    expect(screen.getByText('Example checklist')).toBeTruthy();
  });
});
