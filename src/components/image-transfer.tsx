'use client';

import { useCallback, useEffect, useId, useRef, useState, type HTMLAttributes, type ImgHTMLAttributes } from 'react';
import { buttonClass } from './button-styles';

export function imageFilename(name: string, contentId = 'post'): string {
  const safe = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
  // Transliteration can collapse unrelated zh-TW slugs to the same filename.
  const slug = /[^\p{ASCII}]/u.test(name) ? '' : safe(name);
  return `${slug || safe(contentId) || 'post'}-1.png`;
}

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'onLoad' | 'onDragStart' | 'draggable'> & {
  src: string;
  filename?: string;
  contentId?: string;
  actions?: boolean;
  /** Thumbnails prepare on intent; duplicate and unsaved previews never export. */
  preparation?: 'preview' | 'interaction' | 'none';
  frame?: HTMLAttributes<HTMLDivElement>;
};

/** Remount on source changes so a previous revision can never be exported. */
export function TransferImage(props: Props) {
  return <PreparedImage key={`${props.src}:${props.filename}:${props.contentId}:${props.preparation}:${props.actions}`} {...props} />;
}

function PreparedImage({ filename = '', contentId, actions = true, preparation = actions ? 'preview' : 'none', frame, ...image }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState(preparation === 'interaction' ? 'Interact with the image to prepare it.' : 'Preparing image…');
  const [copySupported, setCopySupported] = useState(false);
  const [shareSupported, setShareSupported] = useState(false);
  const alive = useRef(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const generation = useRef(0);
  const requested = useRef(false);
  const pending = useRef(false);
  const downloads = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const statusId = useId();

  const prepare = useCallback(async (img: HTMLImageElement) => {
    if (!alive.current || preparation === 'none') return;
    const current = ++generation.current;
    pending.current = true;
    setFile(null);
    const canvas = document.createElement('canvas');
    try {
      // Reuse the bytes already loaded by <img>: no extra provider request.
      // SVG previews have a 1080px design width; raster assets keep their size.
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context || !canvas.width || !canvas.height) throw new Error();
      context.drawImage(img, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error()), 'image/png'));
      if (!alive.current || current !== generation.current) return;
      const png = new File([blob], imageFilename(filename, contentId), { type: 'image/png' });
      setFile(png);
      setCopySupported(!!navigator.clipboard?.write && typeof ClipboardItem !== 'undefined');
      setShareSupported(!!navigator.share && !!navigator.canShare?.({ files: [png] }));
      setMessage('Drag the image into a composer. If it does not accept the drop, use Copy image or Download.');
    } catch {
      if (alive.current && current === generation.current) setMessage('This image could not be prepared. Reload to try again.');
    } finally {
      canvas.width = canvas.height = 0;
      if (current === generation.current) pending.current = false;
    }
  }, [filename, contentId, preparation]);

  useEffect(() => {
    alive.current = true;
    // Data previews and cached images may finish before hydration attaches load.
    // Hydration load and React StrictMode's effect replay can both reach here.
    // Reuse preparation already started for this source instead of encoding twice.
    if (preparation === 'preview' && generation.current === 0 && imageRef.current?.complete && imageRef.current.naturalWidth) void prepare(imageRef.current);
    const urls = downloads.current;
    return () => {
      alive.current = false;
      for (const [url, timer] of urls) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      urls.clear();
    };
  }, [prepare, preparation]);

  function prepareOnIntent() {
    if (preparation !== 'interaction') return;
    requested.current = true;
    if (!file && !pending.current && imageRef.current?.complete && imageRef.current.naturalWidth) void prepare(imageRef.current);
  }

  async function copy() {
    if (!file) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': file })]);
      setMessage('Image copied. Paste it into the composer.');
    } catch {
      setMessage('Image could not be copied. Use Download instead.');
    }
  }

  async function share() {
    if (!file) return;
    try {
      await navigator.share({ files: [file] });
      setMessage('Image shared.');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setMessage('Image could not be shared. Use Download instead.');
    }
  }

  function download() {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    // Give the browser time to consume the click before releasing the blob.
    downloads.current.set(url, setTimeout(() => {
      URL.revokeObjectURL(url);
      downloads.current.delete(url);
    }, 1000));
  }

  const picture = (
    <div className={actions ? undefined : "size-full"} draggable={!!file}
      onPointerEnter={prepareOnIntent} onTouchStart={prepareOnIntent} onClick={prepareOnIntent}
      onDragStart={e => {
      // Never allow the native image drag's text/html or URL fallback, including
      // when the browser cannot add files. No DownloadURL or bearer blob URL.
      e.dataTransfer.clearData();
      try {
        if (!file) throw new Error();
        e.dataTransfer.items.clear();
        if (!e.dataTransfer.items.add(file)) throw new Error();
        e.dataTransfer.effectAllowed = 'copy';
      } catch {
        e.preventDefault();
        setMessage('Drag is unavailable here. Use Copy image or Download.');
      }
    }}>
      {/* Suppress Chromium's native image URL/html payload; dragging anywhere on
          this image starts the parent file drag instead. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- authenticated bytes, reused for canvas export */}
      <img {...image} ref={imageRef} alt={image.alt ?? ''} draggable={false} onLoad={e => {
        if (preparation === 'preview' || (preparation === 'interaction' && requested.current)) void prepare(e.currentTarget);
      }} onError={() => setMessage('This image could not be loaded. Reload to try again.')} />
    </div>
  );
  return <>
    {frame ? <div {...frame}>{picture}</div> : picture}
    {actions && preparation !== 'none' ? <div className="mt-2 flex flex-col gap-2">
      <div role="group" aria-label="Image actions" className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass()} disabled={!file || !copySupported} aria-describedby={statusId} onClick={() => void copy()}>Copy image</button>
        <button type="button" className={buttonClass()} disabled={!file} onClick={download}>Download</button>
        {shareSupported ? <button type="button" className={buttonClass()} onClick={() => void share()}>Share</button> : null}
      </div>
      <p id={statusId} role="status" className="text-xs text-ink-soft">{message}{file && !copySupported ? ' Clipboard images are unavailable in this browser. Use Download.' : ''}</p>
    </div> : null}
  </>;
}
