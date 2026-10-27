import { requireActor } from '@/lib/auth';
import { AiUsagePanel } from '@/components/ai-usage-panel';
export const dynamic = 'force-dynamic';
export default async function AiUsagePage() {
  await requireActor('owner');
  return <AiUsagePanel />;
}
