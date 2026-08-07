import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';

const getCachedBanks = unstable_cache(
  async () => {
    const snap = await getDb().collection('masterBanks').orderBy('name').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  ['admin-master-banks'],
  { revalidate: 15 }
);

export async function GET(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const banks = await getCachedBanks();
  return Response.json({ banks });
}
