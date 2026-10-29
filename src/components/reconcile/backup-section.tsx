import { Suspense } from 'react';
import type { BackupCard as BackupCardData } from '@/lib/weekly-backup';
import { BackupCard } from './backup-card';

/**
 * Backup card as its own streamed section (#249). It reads only the database run
 * history, never a provider. A failed read is a quiet error inside this card and
 * cannot break the page. Its button is gated by the page's actions provider.
 */
async function Loaded({ promise, now, isOwner }: { promise: Promise<BackupCardData>; now: number; isOwner: boolean }) {
  const card: BackupCardData = await promise.catch((): BackupCardData => ({ state: 'unavailable' }));
  return (
    <BackupCard
      status={card.state === 'ok' ? card.status : null}
      now={now}
      isOwner={isOwner}
      folderConfigured={card.state === 'ok' ? card.folderConfigured : true}
      unavailable={card.state === 'unavailable'}
    />
  );
}

export function BackupSection(props: { promise: Promise<BackupCardData>; now: number; isOwner: boolean }) {
  return (
    <Suspense
      fallback={
        <section aria-labelledby="backup-h" aria-busy="true" className="rounded-lg border border-line bg-card p-4">
          <h2 id="backup-h" className="text-lg font-semibold">Backup</h2>
          <p role="status" className="mt-2 text-sm text-ink-soft">Checking the last backup.</p>
        </section>
      }
    >
      <Loaded {...props} />
    </Suspense>
  );
}
