import { NextRequest } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getDb } from '@/lib/firebase-admin';
import { directRoomId, TEAM_ROOM_ID } from '@/lib/chat';

export async function GET(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();

  const db = getDb();
  const usersSnap = await db.collection('users').get();
  const otherUsernames = usersSnap.docs.map(d => d.id).filter(u => u !== authUser.username);
  const roomIds = [TEAM_ROOM_ID, ...otherUsernames.map(u => directRoomId(authUser.username, u))];

  const [roomDocs, readDocs] = await Promise.all([
    Promise.all(roomIds.map(id => db.collection('chatRooms').doc(id).get())),
    Promise.all(roomIds.map(id => db.collection('chatRooms').doc(id).collection('reads').doc(authUser.username).get())),
  ]);

  const unreadRoomIds = roomIds.filter((_, i) => {
    const lastMessageAt = roomDocs[i].data()?.lastMessageAt as Timestamp | undefined;
    if (!lastMessageAt) return false;
    const lastReadAt = readDocs[i].data()?.lastReadAt as Timestamp | undefined;
    return !lastReadAt || lastMessageAt.toMillis() > lastReadAt.toMillis();
  });

  return Response.json({ totalUnread: unreadRoomIds.length, unreadRoomIds });
}
