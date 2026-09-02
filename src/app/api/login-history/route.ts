import { NextRequest } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
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

  const sql = getSql();
  const since = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000);

  const [[profile], historyRows] = await Promise.all([
    sql<{ last_login_at: Date | null }[]>`select last_login_at from profiles where username = ${authUser.username}`,
    sql<{ id: string; ip: string | null; user_agent: string | null; created_at: Date }[]>`
      select id, ip, user_agent, created_at from login_history
      where username = ${authUser.username} and created_at >= ${since}
      order by created_at desc
    `,
  ]);

  const lastLoginAt = toTimestamp(profile?.last_login_at);
  const history = historyRows.map(r => ({
    id: r.id, ip: r.ip ?? null, userAgent: r.user_agent ?? null, createdAt: toTimestamp(r.created_at),
  }));

  return Response.json({ lastLoginAt, history });
}
