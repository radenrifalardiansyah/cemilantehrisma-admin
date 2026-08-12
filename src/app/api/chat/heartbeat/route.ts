import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getDb } from '@/lib/firebase-admin';

export async function POST(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();

  await getDb().collection('presence').doc('status').set(
    { [authUser.username]: { lastSeen: FieldValue.serverTimestamp() } },
    { merge: true },
  );
  return Response.json({ ok: true });
}
