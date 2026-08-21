import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { Timestamp } from 'firebase-admin/firestore';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getDb } from '@/lib/firebase-admin';
import { getAllUsernames } from '@/lib/chat-server';
import { directRoomId, TEAM_ROOM_ID } from '@/lib/chat';

// Read count here scales with team size (1 chatRooms + up to 1 reads read per teammate),
// polled every 45s by every open session — a user with several tabs/windows open pays this
// multiple times over. Caching per-username collapses that multi-tab case into one Firestore
// round trip; a 10s-stale unread badge is an acceptable tradeoff for a notification dot.
const getUnreadRoomIds = unstable_cache(
  async (username: string): Promise<string[]> => {
    const db = getDb();
    const usernames = await getAllUsernames();
    const otherUsernames = usernames.filter(u => u !== username);
    const roomIds = [TEAM_ROOM_ID, ...otherUsernames.map(u => directRoomId(username, u))];

    // Single batchGet instead of N separate .get() calls — same read count, one round trip.
    const roomDocs = await db.getAll(...roomIds.map(id => db.collection('chatRooms').doc(id)));

    // Most direct-message pairs in a team never actually talked — skip the reads-subdoc
    // lookup entirely for any room that has no lastMessageAt yet, instead of reading it
    // unconditionally for every possible pair on every poll.
    const active = roomIds
      .map((id, i) => ({ id, lastMessageAt: roomDocs[i].data()?.lastMessageAt as Timestamp | undefined }))
      .filter((r): r is { id: string; lastMessageAt: Timestamp } => !!r.lastMessageAt);

    const readDocs = active.length > 0
      ? await db.getAll(...active.map(r => db.collection('chatRooms').doc(r.id).collection('reads').doc(username)))
      : [];

    return active
      .filter((r, i) => {
        const lastReadAt = readDocs[i].data()?.lastReadAt as Timestamp | undefined;
        return !lastReadAt || r.lastMessageAt.toMillis() > lastReadAt.toMillis();
      })
      .map(r => r.id);
  },
  ['chat-unread-room-ids'],
  { revalidate: 10 },
);

export async function GET(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();

  const unreadRoomIds = await getUnreadRoomIds(authUser.username);
  return Response.json({ totalUnread: unreadRoomIds.length, unreadRoomIds });
}
