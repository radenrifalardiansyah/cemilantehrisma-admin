import { NextRequest } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getDb } from '@/lib/firebase-admin';
import { canAccessRoom } from '@/lib/chat';
import { getRoomRecipients } from '@/lib/chat-server';

type Ctx = { params: Promise<{ roomId: string }> };

// Watermark = the slowest recipient's lastReadAt. A message is read once its createdAt
// is at or before this — lets the client refresh ticks on already-rendered messages
// without refetching the whole message list.
export async function GET(req: NextRequest, ctx: Ctx) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();
  const { roomId } = await ctx.params;
  if (!canAccessRoom(roomId, authUser.username)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const recipients = await getRoomRecipients(roomId, authUser.username);
  if (recipients.length === 0) return Response.json({ readWatermark: null });

  const readsSnap = await getDb().collection('chatRooms').doc(roomId).collection('reads').get();
  const lastReadAtByUser = new Map(readsSnap.docs.map(d => [d.id, d.data().lastReadAt as Timestamp | undefined]));
  const minMs = Math.min(...recipients.map(u => lastReadAtByUser.get(u)?.toMillis() ?? 0));

  return Response.json({ readWatermark: minMs > 0 ? new Date(minMs).toISOString() : null });
}
