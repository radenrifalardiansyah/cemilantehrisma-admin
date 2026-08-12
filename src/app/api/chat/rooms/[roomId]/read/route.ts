import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getDb } from '@/lib/firebase-admin';
import { canAccessRoom } from '@/lib/chat';

type Ctx = { params: Promise<{ roomId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();
  const { roomId } = await ctx.params;
  if (!canAccessRoom(roomId, authUser.username)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  await getDb()
    .collection('chatRooms').doc(roomId)
    .collection('reads').doc(authUser.username)
    .set({ lastReadAt: FieldValue.serverTimestamp() }, { merge: true });

  return Response.json({ ok: true });
}
