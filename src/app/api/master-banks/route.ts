import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';

const getCachedBanks = unstable_cache(
  async () => {
    const snap = await getDb().collection('masterBanks').orderBy('name').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  ['admin-master-banks'],
  { revalidate: 15 }
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'settings', 'view');
  if (guard instanceof Response) return guard;
  const banks = await getCachedBanks();
  return Response.json({ banks });
}
