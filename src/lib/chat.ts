export const TEAM_ROOM_ID = 'team';
export const PRESENCE_ONLINE_WINDOW_MS = 45_000;

// Firestore Timestamp serialized over JSON (Response.json()) lands as {seconds, nanoseconds}.
export type SerializedTimestamp = { seconds: number; nanoseconds: number };

// Label "terakhir login" ala WhatsApp untuk kontak yang sedang offline.
export function formatLastSeen(ts: SerializedTimestamp | null | undefined): string {
  if (!ts) return 'Belum pernah login';
  const diffMs = Date.now() - ts.seconds * 1000;
  if (diffMs < 60_000) return 'Terakhir login barusan';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `Terakhir login ${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Terakhir login ${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Terakhir login ${days} hari lalu`;
  const date = new Date(ts.seconds * 1000);
  return `Terakhir login ${date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

// '~' (not '_') so a username containing an underscore can't be split ambiguously.
export function directRoomId(a: string, b: string): string {
  return `dm_${[a, b].sort().join('~')}`;
}

// Direct-room access is derived from the room id itself (no extra read needed) — the id only
// ever gets constructed by directRoomId() for the two people in that conversation.
export function canAccessRoom(roomId: string, username: string): boolean {
  if (roomId === TEAM_ROOM_ID) return true;
  if (!roomId.startsWith('dm_')) return false;
  const members = roomId.slice(3).split('~');
  return members.length === 2 && members.includes(username);
}
