import { buttonClass } from '../button-styles';

/**
 * "The Sheet draft and the Markdown section differ" (CS-058). It used to sit above
 * the copy and pushed the text down on every open; it now lives at the bottom of
 * the editor, after the review controls, where it is still there to read when the
 * Save button says "Make the Sheet match the Markdown" but never gets in the way.
 */
export function MismatchNotice({ sheetDraft, canEdit, onUseSheetVersion }: {
  sheetDraft: string;
  canEdit: boolean;
  onUseSheetVersion: () => void;
}) {
  return (
    <div className="rounded-md border border-line bg-paper p-3 text-sm">
      <p className="font-semibold">The Sheet draft and the Markdown section differ.</p>
      <p className="mt-1">The editor loaded the Markdown version, which is canonical. Saving will make the Sheet match it exactly. Compare first if you are unsure.</p>
      <details className="mt-2">
        <summary className="cursor-pointer">Show the Sheet version</summary>
        <pre className="copy mt-2 rounded bg-card p-2 font-sans text-sm">{sheetDraft}</pre>
        {canEdit ? (
          <button type="button" className={`${buttonClass()} mt-2`} onClick={onUseSheetVersion}>
            Start from the Sheet version instead
          </button>
        ) : null}
      </details>
    </div>
  );
}
