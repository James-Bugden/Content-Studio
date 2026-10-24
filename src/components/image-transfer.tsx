'use client';

import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type ImgHTMLAttributes } from 'react';
import { buttonClass } from './button-styles';

export function imageFilename(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'post'}-1.png`;
}

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'onLoad' | 'onDragStart' | 'draggable'> & {
  src: string;
  filename?: string;
  actions?: boolean;
  frame?: HTMLAttributes<HTMLDivElement>;
};

/** Remount on source changes so a previous revision can never be exported. */
export function TransferImage(props: Props) {
  return <PreparedImage key={`${props.src}:${props.filename}`} {...props} />;
}

function PreparedImage({ filename = 'post', actions = true, frame, ...image }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('Preparing image…');
  const [copySupported, setCopySupported] = useState(false);
  const [shareSupported, setShareSupported] = useState(false);
  const alive = useRef(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const generation = useRef(0);

  const prepare = useCallback(async (img: HTMLImageElement) => {
    if (!alive.current) return;
    const current = ++generation.current;
    try {
      // Reuse the bytes already loaded by <img>: no extra provider request.
      // SVG previews have a 1080px design width; raster assets keep their size.
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context || !canvas.width || !canvas.height) throw new Error();
      context.drawImage(img, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error()), 'image/png'));
      if (!alive.current || current !== generation.current) return;
      const png = new File([blob], imageFilename(filename), { type: 'image/png' });
      setFile(png);
      setCopySupported(!!navigator.clipboard?.write && typeof ClipboardItem !== 'undefined');
      setShareSupported(!!navigator.share && !!navigator.canShare?.({ files: [png] }));
      setMessage('Drag the image into a composer. If it does not accept the drop, use Copy image or Download.');
    } catch {
      if (alive.current && current === generation.current) setMessage('This image could not be prepared. Reload to try again.');
    }
  }, [filename]);

  useEffect(() => {
    alive.current = true;
    // Data previews and cached images may finish before hydration attaches load.
    if (imageRef.current?.complete && imageRef.current.naturalWidth) void prepare(imageRef.current);
    return () => { alive.current = false; };
  }, [prepare]);

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
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const picture = (
    <div className={actions ? undefined : "size-full"} draggable={!!file} onDragStart={e => {
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
      <img {...image} ref={imageRef} alt={image.alt ?? ''} draggable={false} onLoad={e => void prepare(e.currentTarget)} onError={() => setMessage('This image could not be loaded. Reload to try again.')} />
    </div>
  );
  return <>
    {frame ? <div {...frame}>{picture}</div> : picture}
    {actions ? <div className="mt-2 flex flex-col gap-2">
      <div role="group" aria-label="Image actions" className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass()} disabled={!file || !copySupported} title={file && !copySupported ? 'Clipboard images are unavailable in this browser. Use Download.' : undefined} onClick={() => void copy()}>Copy image</button>
        <button type="button" className={buttonClass()} disabled={!file} onClick={download}>Download</button>
        {shareSupported ? <button type="button" className={buttonClass()} onClick={() => void share()}>Share</button> : null}
      </div>
      <p role="status" className="text-xs text-ink-soft">{message}</p>
    </div> : null}
  </>;
}
