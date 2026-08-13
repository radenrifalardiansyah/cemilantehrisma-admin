import { NextRequest } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getDb, serializeTimestamp } from '@/lib/firebase-admin';

const HISTORY_DAYS = 7;

// Selalu scoped ke akun pemanggil sendiri (tidak menerima parameter username) — riwayat login
// user lain bukan urusan profil pribadi siapa pun di sini.
export async function GET(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();

  const db = getDb();
  const since = Timestamp.fromMillis(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000);

  const [userDoc, historySnap] = await Promise.all([
    db.collection('users').doc(authUser.username).get(),
    db.collection('login_history')
      .where('username', '==', authUser.username)
      .where('createdAt', '>=', since)
      .orderBy('createdAt', 'desc')
      .get(),
  ]);

  const lastLoginAt = serializeTimestamp(userDoc.data()?.lastLoginAt ?? null);
  const history = historySnap.docs.map(d => {
    const data = d.data() as { ip?: string; userAgent?: string; createdAt?: Timestamp };
    return { id: d.id, ip: data.ip ?? null, userAgent: data.userAgent ?? null, createdAt: serializeTimestamp(data.createdAt) };
  });

  return Response.json({ lastLoginAt, history });
}
