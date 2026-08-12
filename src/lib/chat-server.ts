import { getDb } from './firebase-admin';
import { TEAM_ROOM_ID } from './chat';

// "Recipients" of a room from one user's point of view — every other account for the
// team room, the other member for a DM. Used to derive WhatsApp-style read receipts.
export async function getRoomRecipients(roomId: string, username: string): Promise<string[]> {
  if (roomId === TEAM_ROOM_ID) {
    const snap = await getDb().collection('users').get();
    return snap.docs.map(d => d.id).filter(u => u !== username);
  }
  return roomId.slice(3).split('~').filter(u => u !== username);
}
