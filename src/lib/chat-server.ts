import { unstable_cache } from 'next/cache';
import { getDb } from './firebase-admin';
import { TEAM_ROOM_ID } from './chat';

// Just the username list, not full account docs — this is what chat's presence/unread/
// team-recipients lookups actually need, and they're all hit by polling loops (every
// 10-45s per open session). Cached for 20s so N concurrent admin tabs share one Firestore
// scan of `users` instead of each poll re-scanning the whole collection.
export const getAllUsernames = unstable_cache(
  async () => {
    const snap = await getDb().collection('users').get();
    return snap.docs.map(d => d.id);
  },
  ['chat-all-usernames'],
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
