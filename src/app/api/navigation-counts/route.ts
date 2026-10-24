import { getServices } from '@/application/container';
import { cachedNavigationCounts } from '@/application/navigation-counts';
import { requireActor } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireActor('viewer');
    return json(cachedNavigationCounts(getServices().repo));
  } catch (error) {
    return errorResponse(error);
  }
}
