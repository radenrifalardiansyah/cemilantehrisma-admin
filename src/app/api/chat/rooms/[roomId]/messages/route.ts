import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getSql } from '@/lib/db';
import { canAccessRoom, TEAM_ROOM_ID } from '@/lib/chat';
import { getRoomRecipients } from '@/lib/chat-server';
import { sendPush } from '@/lib/notifications';
import { getDb } from '@/lib/firebase-admin';

type Ctx = { params: Promise<{ roomId: string }> };
interface MessageRow { id: string; text: string; sender_username: string; created_at: Date }

export async function GET(req: NextRequest, ctx: Ctx) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();
  const { roomId } = await ctx.params;
  if (!canAccessRoom(roomId, authUser.username)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const after = new URL(req.url).searchParams.get('after');
  const afterDate = after ? new Date(after) : null;
  const sql = getSql();

  const [rows, readRows, recipients] = await Promise.all([
    afterDate && !isNaN(afterDate.getTime())
      ? sql<MessageRow[]>`select id, text, sender_username, created_at from chat_messages where room_id = ${roomId} and created_at > ${afterDate} order by created_at asc limit 200`
      : sql<MessageRow[]>`select id, text, sender_username, created_at from (select id, text, sender_username, created_at from chat_messages where room_id = ${roomId} order by created_at desc limit 100) t order by created_at asc`,
    sql<{ username: string; last_read_at: Date | null }[]>`select username, last_read_at from chat_reads where room_id = ${roomId}`,
    getRoomRecipients(roomId, authUser.username),
  ]);

  const lastReadMsByUser = new Map(readRows.map(r => [r.username, r.last_read_at ? r.last_read_at.getTime() : 0]));

  const messages = rows.map(r => {
    const createdAtMs = r.created_at.getTime();
    const mine = r.sender_username === authUser.username;
    const read = mine && recipients.length > 0
      && recipients.every(u => (lastReadMsByUser.get(u) ?? 0) >= createdAtMs);
    return {
      id: r.id,
      text: r.text,
      senderUsername: r.sender_username,
      createdAt: r.created_at.toISOString(),
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

  const sql = getSql();
  const messageId = randomUUID();
  const roomType = roomId === TEAM_ROOM_ID ? 'group' : 'direct';

  await sql.begin(async pgTx => {
    await pgTx`
      insert into chat_rooms (id, type, last_message, last_message_at, created_at)
      values (${roomId}, ${roomType}, ${JSON.stringify({ text: trimmed, senderUsername: authUser.username })}, now(), now())
      on conflict (id) do update set
        type = ${roomType}, last_message = ${JSON.stringify({ text: trimmed, senderUsername: authUser.username })}, last_message_at = now()
    `;
    await pgTx`insert into chat_messages (id, room_id, sender_username, text, created_at) values (${messageId}, ${roomId}, ${authUser.username}, ${trimmed}, now())`;
  });

  // Push best-effort setelah commit — sama seperti writeNotification, supaya tidak dobel kirim.
  const recipients = await getRoomRecipients(roomId, authUser.username);
  const preview = trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed;
  await sendPush(
    getDb(),
    { title: roomId === TEAM_ROOM_ID ? 'Chat Tim' : authUser.username, message: roomId === TEAM_ROOM_ID ? `${authUser.username}: ${preview}` : preview },
    { usernames: recipients, data: { chatRoomId: roomId } },
  ).catch(err => console.error('Failed to send push for chat message', err));

  return Response.json({ id: messageId });
}
