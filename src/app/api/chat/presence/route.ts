import { NextRequest } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getDb } from '@/lib/firebase-admin';
import { getAllUsernames } from '@/lib/chat-server';
import { PRESENCE_ONLINE_WINDOW_MS } from '@/lib/chat';

export async function GET(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();

  const [usernames, presenceDoc] = await Promise.all([
    getAllUsernames(),
    getDb().collection('presence').doc('status').get(),
  ]);
  const presence = presenceDoc.data() as Record<string, { lastSeen?: Timestamp }> | undefined;
  const now = Date.now();

  const accounts = usernames.map(username => {
    const lastSeen = presence?.[username]?.lastSeen;
    const online = !!lastSeen && now - lastSeen.toMillis() < PRESENCE_ONLINE_WINDOW_MS;
    return { username, online };
  });

  return Response.json({ accounts, onlineCount: accounts.filter(a => a.online).length });
}
