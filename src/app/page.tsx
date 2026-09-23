import { redirect } from 'next/navigation';
import { getActor } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Home is the review queue. Anonymous and no-role sessions go to /login (SEC-05). */
export default async function Home() {
  const actor = await getActor();
  redirect(actor ? '/review' : '/login');
}
