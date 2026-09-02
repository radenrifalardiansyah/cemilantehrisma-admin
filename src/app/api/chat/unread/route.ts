import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getSql } from '@/lib/db';
import { getAllUsernames } from '@/lib/chat-server';
import { directRoomId, TEAM_ROOM_ID } from '@/lib/chat';

// Read count here scales with team size (1 chat_rooms + up to 1 chat_reads read per teammate),
// polled every 45s by every open session — a user with several tabs/windows open pays this
// multiple times over. Caching per-username collapses that multi-tab case into one query.
// (Tahap chat migrasi Fase 2 — lihat plan gleaming-wondering-quokka.md.)
const getUnreadRoomIds = unstable_cache(
  async (username: string): Promise<string[]> => {
    const sql = getSql();
    const usernames = await getAllUsernames();
    const otherUsernames = usernames.filter(u => u !== username);
    const roomIds = [TEAM_ROOM_ID, ...otherUsernames.map(u => directRoomId(username, u))];

    const roomRows = await sql<{ id: string; last_message_at: Date | null }[]>`
      select id, last_message_at from chat_rooms where id in ${sql(roomIds)}
    `;
    const lastMessageAtById = new Map(roomRows.map(r => [r.id, r.last_message_at]));

    // Most direct-message pairs in a team never actually talked — skip the reads lookup
    // entirely for any room that has no last_message_at yet, instead of reading it
    // unconditionally for every possible pair on every poll.
    const active = roomIds
      .map(id => ({ id, lastMessageAt: lastMessageAtById.get(id) }))
      .filter((r): r is { id: string; lastMessageAt: Date } => !!r.lastMessageAt);

    const readRows = active.length > 0
      ? await sql<{ room_id: string; last_read_at: Date | null }[]>`
          select room_id, last_read_at from chat_reads
          where username = ${username} and room_id in ${sql(active.map(r => r.id))}
        `
      : [];
    const lastReadAtByRoom = new Map(readRows.map(r => [r.room_id, r.last_read_at]));

    return active
      .filter(r => {
        const lastReadAt = lastReadAtByRoom.get(r.id);
        return !lastReadAt || r.lastMessageAt.getTime() > lastReadAt.getTime();
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
