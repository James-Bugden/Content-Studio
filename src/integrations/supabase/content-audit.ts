import 'server-only';
import { LIBRARY_HEADERS, SCHEDULE_HEADERS } from '@/domain/sheet-schema';
import { contentColumn, sha256 } from './content-repository';

export type ContentAuditEvent = {
  operation_id: string; actor_hash: string; target_kind: string; target_id: string;
  changed_fields: string[]; before_hash: string | null; after_hash: string | null; outcome: string;
};
const fields = new Set([...Object.keys(LIBRARY_HEADERS), ...Object.keys(SCHEDULE_HEADERS)].map(contentColumn)
  .concat(['final_synced_hash', 'image_file_url', 'source_link_url', 'source_markdown_url', 'source_master_file_url', 'source_sheet_row', 'sheet_revision', 'passthrough']));

/** Explicit public evidence projection. Never spread a database row into an export. */
export function exportContentAudit(events: readonly ContentAuditEvent[]) {
  return events.map(e => ({
    operationHash: sha256(e.operation_id).slice(0, 12), actorHash: sha256(e.actor_hash).slice(0, 12), targetHash: sha256(e.target_id).slice(0, 12),
    targetKind: ['library', 'queue', 'schedule', 'workflow_settings'].includes(e.target_kind) ? e.target_kind : 'unknown',
    changedFields: e.changed_fields.filter(f => fields.has(f)),
    beforeHash: e.before_hash ? sha256(e.before_hash).slice(0, 12) : null,
    afterHash: e.after_hash ? sha256(e.after_hash).slice(0, 12) : null,
    outcome: ['applied', 'already_applied', 'stale', 'not_found', 'conflict'].includes(e.outcome) ? e.outcome : 'unknown',
  }));
}
