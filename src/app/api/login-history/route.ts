import { NextRequest } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getDb, serializeTimestamp } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';

const HISTORY_DAYS = 7;

function toTimestamp(d: Date | null | undefined) {
  if (!d) return null;
  return { seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 };
}

// Selalu scoped ke akun pemanggil sendiri (tidak menerima parameter username) — riwayat login
// user lain bukan urusan profil pribadi siapa pun di sini.
export async function GET(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();

  const db = getDb();
  const sql = getSql();
  const since = Timestamp.fromMillis(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000);

  const [[profile], historySnap] = await Promise.all([
    sql<{ last_login_at: Date | null }[]>`select last_login_at from profiles where username = ${authUser.username}`,
    db.collection('login_history')
      .where('username', '==', authUser.username)
      .where('createdAt', '>=', since)
      .orderBy('createdAt', 'desc')
      .get(),
  ]);

  const lastLoginAt = toTimestamp(profile?.last_login_at);
  const history = historySnap.docs.map(d => {
    const data = d.data() as { ip?: string; userAgent?: string; createdAt?: Timestamp };
    return { id: d.id, ip: data.ip ?? null, userAgent: data.userAgent ?? null, createdAt: serializeTimestamp(data.createdAt) };
  });

  return Response.json({ lastLoginAt, history });
}
