import { NextRequest } from 'next/server';
import { FieldValue, Timestamp, Query, DocumentData } from 'firebase-admin/firestore';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getDb } from '@/lib/firebase-admin';
import { canAccessRoom, TEAM_ROOM_ID } from '@/lib/chat';
import { getRoomRecipients } from '@/lib/chat-server';
import { sendPush } from '@/lib/notifications';

type Ctx = { params: Promise<{ roomId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();
  const { roomId } = await ctx.params;
  if (!canAccessRoom(roomId, authUser.username)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const after = new URL(req.url).searchParams.get('after');
  const afterDate = after ? new Date(after) : null;
  const roomRef = getDb().collection('chatRooms').doc(roomId);
  const messagesRef = roomRef.collection('messages');

  let query: Query<DocumentData> = messagesRef.orderBy('createdAt', 'asc');
  query = afterDate && !isNaN(afterDate.getTime())
    ? query.where('createdAt', '>', Timestamp.fromDate(afterDate)).limit(200)
    : query.limitToLast(100);

  const [snap, readsSnap, recipients] = await Promise.all([
    query.get(),
    roomRef.collection('reads').get(),
    getRoomRecipients(roomId, authUser.username),
  ]);

  const lastReadMsByUser = new Map(readsSnap.docs.map(d => {
    const lastReadAt = d.data().lastReadAt as Timestamp | undefined;
    return [d.id, lastReadAt ? lastReadAt.toMillis() : 0];
  }));

  const messages = snap.docs.map(d => {
    const data = d.data() as { text: string; senderUsername: string; createdAt?: Timestamp };
    const createdAtMs = data.createdAt ? data.createdAt.toMillis() : null;
    const mine = data.senderUsername === authUser.username;
    const read = mine && createdAtMs !== null && recipients.length > 0
      && recipients.every(u => (lastReadMsByUser.get(u) ?? 0) >= createdAtMs);
    return {
      id: d.id,
      text: data.text,
      senderUsername: data.senderUsername,
      createdAt: createdAtMs !== null ? data.createdAt!.toDate().toISOString() : null,
      read,
    };
  });
  return Response.json({ messages });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();
  const { roomId } = await ctx.params;
  if (!canAccessRoom(roomId, authUser.username)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { text } = await req.json() as { text?: string };
  const trimmed = (text ?? '').trim();
  if (!trimmed) return Response.json({ error: 'Pesan tidak boleh kosong.' }, { status: 400 });
  if (trimmed.length > 2000) return Response.json({ error: 'Pesan terlalu panjang.' }, { status: 400 });

  const db = getDb();
  const roomRef = db.collection('chatRooms').doc(roomId);
  const messageRef = roomRef.collection('messages').doc();

  await db.runTransaction(async tx => {
    const roomDoc = await tx.get(roomRef);
    const roomPatch: Record<string, unknown> = {
      type: roomId === TEAM_ROOM_ID ? 'group' : 'direct',
      lastMessage: { text: trimmed, senderUsername: authUser.username },
      lastMessageAt: FieldValue.serverTimestamp(),
    };
    if (!roomDoc.exists) roomPatch.createdAt = FieldValue.serverTimestamp();
    tx.set(roomRef, roomPatch, { merge: true });
    tx.set(messageRef, {
      text: trimmed,
      senderUsername: authUser.username,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  // Push HARUS setelah commit (bukan di dalam transaksi) — sama seperti writeNotification,
  // supaya retry transaksi karena write conflict tidak mengirim push dobel.
  const recipients = await getRoomRecipients(roomId, authUser.username);
  const preview = trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed;
  await sendPush(
    db,
    { title: roomId === TEAM_ROOM_ID ? 'Chat Tim' : authUser.username, message: roomId === TEAM_ROOM_ID ? `${authUser.username}: ${preview}` : preview },
    { usernames: recipients, data: { chatRoomId: roomId } },
  ).catch(err => console.error('Failed to send push for chat message', err));

  return Response.json({ id: messageRef.id });
}
