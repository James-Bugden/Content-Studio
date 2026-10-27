'use client';

import type { Gate } from '@/domain/gates';
import { buttonClass } from '../button-styles';

export function ApprovalHelp({ libraryId, dirty, blockers, imageHref = '#panel-image', onShowQa }: { libraryId: string; dirty: boolean; blockers: readonly Gate[]; imageHref?: string; onShowQa?: () => void }) {
  return <div className="space-y-2 text-base">
    {dirty ? <p>Save the draft before approving.{' '}
      <button type="button" className={buttonClass()} onClick={() => document.getElementById(`save-draft-${libraryId}`)?.click()}>Save before approving</button>
    </p> : null}
    {blockers.map((gate, i) => <p key={`${gate.code}-${i}`}>
      {gate.message}{' '}
      <a className="inline-flex min-h-11 items-center underline" onClick={() => { if (!/^(VISUAL_|SCREENSHOT_)/.test(gate.code)) onShowQa?.(); }} href={/^(VISUAL_|SCREENSHOT_)/.test(gate.code) ? imageHref : `#qa-${libraryId}`}>{gate.nextAction}</a>
    </p>)}
  </div>;
}
