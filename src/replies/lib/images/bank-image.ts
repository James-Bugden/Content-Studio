import { shortHash } from '@/domain/hash';
import type { BankImage } from '@/replies/lib/contracts/api';

/**
 * The public shape of a bank image (#245), and the sketch approval stamp.
 *
 * A bank image is only ever described to the browser by this shape. It carries a
 * same-origin URL to an owner-checked route, never a storage path, and never the
 * brief that was used to make it.
 */

export interface BankImageRecord {
  id: string;
  version: number;
  title: string;
  alt_text: string;
  tags: string[];
  origin: 'upload' | 'created';
  status: 'sketch' | 'ready';
  mime_type: string | null;
  byte_size: number;
  sketch: string;
  sketch_approved_hash: string | null;
  active: boolean;
}

/** A stamp of the exact sketch text, so an approval cannot outlive an edit. */
export function sketchStamp(sketch: string): string {
  return shortHash(sketch);
}

export function bankImageUrl(id: string): string {
  return `/api/replies/images/${id}/file`;
}

export function isSketchApproved(row: Pick<BankImageRecord, 'sketch' | 'sketch_approved_hash'>): boolean {
  return row.sketch !== '' && row.sketch_approved_hash === sketchStamp(row.sketch);
}

export function toBankImage(row: BankImageRecord): BankImage {
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    alt_text: row.alt_text,
    tags: row.tags,
    origin: row.origin,
    status: row.status,
    mime_type: row.mime_type,
    byte_size: row.byte_size,
    sketch: row.sketch,
    sketch_approved: isSketchApproved(row),
    active: row.active,
    url: row.status === 'ready' ? bankImageUrl(row.id) : null,
  };
}
