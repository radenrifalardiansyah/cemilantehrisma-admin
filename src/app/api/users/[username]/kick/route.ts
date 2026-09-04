import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requireAdminOrSuperAdmin, assertCanKickUser, SESSION_TAG } from '@/lib/rbac';

type Ctx = { params: Promise<{ username: string }> };

// Force-logout ("kick") — dipakai dari daftar "Akun Aktif" di widget Chat. Membunuh sesi target
// dengan mekanisme yang sama seperti reset password paksa (bump sessions_invalidated_at), jadi
// token target ditolak di request berikutnya di perangkat manapun.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requireAdminOrSuperAdmin(req);
  if (guard instanceof Response) return guard;
  const { username } = await ctx.params;

  const sql = getSql();
  const [target] = await sql<{ role: string }[]>`select role from profiles where username = ${username}`;
  if (!target) return Response.json({ error: 'Pengguna tidak ditemukan.' }, { status: 404 });

  const check = assertCanKickUser(guard, username, target.role);
  if (!check.ok) return Response.json({ error: check.error }, { status: 400 });

  await sql`
    update profiles set
      sessions_invalidated_at = ${Math.floor(Date.now() / 1000)},
      sessions_invalidated_reason = ${`Anda dikeluarkan paksa oleh ${guard.username}.`}
    where username = ${username}
  `;
  await sql`delete from presence where username = ${username}`;
  revalidateTag(SESSION_TAG, { expire: 0 });
  return Response.json({ ok: true });
}
