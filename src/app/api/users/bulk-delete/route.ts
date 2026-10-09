import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission, assertCanDeleteUser, SESSION_TAG } from '@/lib/rbac';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'users', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const sql = getSql();
  const candidates = ids.filter((id): id is string => typeof id === 'string');
  const found = candidates.length > 0
    ? await sql<{ id: string; username: string; role: string }[]>`select id, username, role from profiles where username in ${sql(candidates)}`
    : [];
  // Lewati diri sendiri dan (kalau bukan Super Admin) akun Super Admin.
  const rows = found.filter(r => assertCanDeleteUser(guard, r.username, r.role).ok);
  const skippedSelf = ids.length - rows.length;

  // Hanya hapus profil yang akun otentikasinya benar-benar terhapus — kalau Supabase gagal,
  // profil dibiarkan supaya user tidak jadi yatim (bisa login tapi tanpa profil).
  const results = await Promise.all(rows.map(async r => ({ r, error: (await getSupabaseAdmin().auth.admin.deleteUser(r.id)).error })));
  const okRows = results.filter(x => !x.error).map(x => x.r);
  if (okRows.length > 0) {
    await sql`delete from profiles where username in ${sql(okRows.map(r => r.username))}`;
    await sql`delete from stall_users where username in ${sql(okRows.map(r => r.username))}`;
    revalidateTag(SESSION_TAG, { expire: 0 });
  }

  return Response.json({ deleted: okRows.length, skippedSelf, failed: results.length - okRows.length });
}
