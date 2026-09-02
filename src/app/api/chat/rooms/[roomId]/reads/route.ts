import { NextRequest } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getSql } from '@/lib/db';
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

  const sql = getSql();
  const readRows = await sql<{ username: string; last_read_at: Date | null }[]>`select username, last_read_at from chat_reads where room_id = ${roomId}`;
  const lastReadAtByUser = new Map(readRows.map(r => [r.username, r.last_read_at]));
  const minMs = Math.min(...recipients.map(u => lastReadAtByUser.get(u)?.getTime() ?? 0));

  return Response.json({ readWatermark: minMs > 0 ? new Date(minMs).toISOString() : null });
}
