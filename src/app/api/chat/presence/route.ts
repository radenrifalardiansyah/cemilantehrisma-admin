import { NextRequest } from 'next/server';
import { requireSession } from '@/lib/rbac';
import { getSql } from '@/lib/db';
import { getAllUsernames } from '@/lib/chat-server';
import { PRESENCE_ONLINE_WINDOW_MS } from '@/lib/chat';

export async function GET(req: NextRequest) {
  const authUser = await requireSession(req);
  if (authUser instanceof Response) return authUser;

  const sql = getSql();
  const [usernames, presenceRows] = await Promise.all([
    getAllUsernames(),
    sql<{ username: string; last_seen: Date | null }[]>`select username, last_seen from presence`,
  ]);
  const lastSeenByUser = new Map(presenceRows.map(r => [r.username, r.last_seen]));
  const now = Date.now();

  const accounts = usernames.map(username => {
    const lastSeen = lastSeenByUser.get(username);
    const online = !!lastSeen && now - lastSeen.getTime() < PRESENCE_ONLINE_WINDOW_MS;
    return { username, online };
  });

  return Response.json({ accounts, onlineCount: accounts.filter(a => a.online).length });
}
