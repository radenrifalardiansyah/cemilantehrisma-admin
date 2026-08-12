import { NextRequest } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getDb } from '@/lib/firebase-admin';
import { PRESENCE_ONLINE_WINDOW_MS } from '@/lib/chat';

export async function GET(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();

  const db = getDb();
  const [usersSnap, presenceDoc] = await Promise.all([
    db.collection('users').get(),
    db.collection('presence').doc('status').get(),
  ]);
  const presence = presenceDoc.data() as Record<string, { lastSeen?: Timestamp }> | undefined;
  const now = Date.now();

  const accounts = usersSnap.docs.map(d => {
    const lastSeen = presence?.[d.id]?.lastSeen;
    const online = !!lastSeen && now - lastSeen.toMillis() < PRESENCE_ONLINE_WINDOW_MS;
    return { username: d.id, online };
  });

  return Response.json({ accounts, onlineCount: accounts.filter(a => a.online).length });
}
