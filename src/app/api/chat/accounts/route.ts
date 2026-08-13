import { NextRequest } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getDb, serializeTimestamp } from '@/lib/firebase-admin';

export async function GET(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();

  const snap = await getDb().collection('users').get();
  const accounts = snap.docs.map(d => {
    const data = d.data() as { role?: string; avatar?: string | null; lastLoginAt?: Timestamp };
    return { username: d.id, role: data.role ?? '', avatar: data.avatar ?? null, lastLoginAt: serializeTimestamp(data.lastLoginAt) };
  });
  return Response.json({ accounts });
}
