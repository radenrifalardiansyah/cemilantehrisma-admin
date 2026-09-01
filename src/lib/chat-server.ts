import { unstable_cache } from 'next/cache';
import { getSql } from './db';
import { TEAM_ROOM_ID } from './chat';

// Just the username list, not full account docs — this is what chat's presence/unread/
// team-recipients lookups actually need, and they're all hit by polling loops (every
// 10-45s per open session). `profiles` pindah ke Postgres (Tahap 7 migrasi, lihat plan
// gleaming-wondering-quokka.md) — Postgres tidak punya quota baca harian, tapi tetap di-cache
// 20 detik di sini supaya N tab admin yang lagi buka bersamaan berbagi satu query.
export const getAllUsernames = unstable_cache(
  async () => {
    const sql = getSql();
    const rows = await sql<{ username: string }[]>`select username from profiles`;
    return rows.map(r => r.username);
  },
  ['chat-all-usernames'],
  { revalidate: 20 },
);

// Full account docs (role/avatar/lastLoginAt) — used by GET /api/chat/accounts, which fires
// once per ChatWidget mount, i.e. every session.
export const getAllAccounts = unstable_cache(
  async () => {
    const sql = getSql();
    const rows = await sql<{ username: string; role: string | null; avatar: string | null; last_login_at: Date | null }[]>`
      select username, role, avatar, last_login_at from profiles
    `;
    return rows.map(r => ({
      username: r.username, role: r.role ?? '', avatar: r.avatar ?? null,
      lastLoginAt: r.last_login_at ? { seconds: Math.floor(r.last_login_at.getTime() / 1000), nanoseconds: 0 } : null,
    }));
  },
  ['chat-all-accounts'],
  { revalidate: 20 },
);

// "Recipients" of a room from one user's point of view — every other account for the
// team room, the other member for a DM. Used to derive WhatsApp-style read receipts.
export async function getRoomRecipients(roomId: string, username: string): Promise<string[]> {
  if (roomId === TEAM_ROOM_ID) {
    const usernames = await getAllUsernames();
    return usernames.filter(u => u !== username);
  }
  return roomId.slice(3).split('~').filter(u => u !== username);
}
