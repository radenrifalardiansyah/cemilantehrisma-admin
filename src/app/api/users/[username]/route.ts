import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission, assertCanEditUser, assertCanDeleteUser, SESSION_TAG } from '@/lib/rbac';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

type Ctx = { params: Promise<{ username: string }> };

interface ProfileRow { id: string; email: string | null; role: string; must_change_password: boolean; sessions_invalidated_at: string | null }

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'users', 'edit');
  if (guard instanceof Response) return guard;
  const { username } = await ctx.params;

  const { email, role, password } =
    await req.json() as { email?: string; role?: string; password?: string };

  const check = assertCanEditUser(guard, username, { role });
  if (!check.ok) return Response.json({ error: check.error }, { status: 400 });

  const sql = getSql();
  if (role) {
    const [roleRow] = await sql`select id from roles where id = ${role}`;
    if (!roleRow) return Response.json({ error: `Role "${role}" tidak ditemukan.` }, { status: 400 });
  }

  const [profile] = await sql<ProfileRow[]>`select id, email, role, must_change_password, sessions_invalidated_at from profiles where username = ${username}`;
  if (!profile) return Response.json({ error: 'Pengguna tidak ditemukan.' }, { status: 404 });

  if (password) {
    const { error } = await getSupabaseAdmin().auth.admin.updateUserById(profile.id, { password });
    if (error) return Response.json({ error: `Gagal reset password: ${error.message}` }, { status: 500 });
  }

  // Role berubah atau password direset paksa oleh admin lain — token yang sudah dipegang user
  // ini di perangkat manapun (sisa masa berlaku sampai 7 hari) harus langsung ditolak di request
  // berikutnya, bukan tetap jalan dengan role/akses lama sampai dia kebetulan login ulang sendiri.
  const revokesSessions = !!role || !!password;
  const nextEmail = email !== undefined ? (email ? email.trim().toLowerCase() : null) : profile.email;
  const nextRole = role ?? profile.role;
  const nextMustChange = password ? true : profile.must_change_password;
  const nextInvalidatedAt = revokesSessions ? Math.floor(Date.now() / 1000) : (Number(profile.sessions_invalidated_at) || null);

  await sql`
    update profiles set
      email = ${nextEmail}, role = ${nextRole}, must_change_password = ${nextMustChange},
      sessions_invalidated_at = ${nextInvalidatedAt}, updated_at = now()
    where username = ${username}
  `;
  if (revokesSessions) revalidateTag(SESSION_TAG, { expire: 0 });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'users', 'delete');
  if (guard instanceof Response) return guard;
  const { username } = await ctx.params;

  const check = assertCanDeleteUser(guard, username);
  if (!check.ok) return Response.json({ error: check.error }, { status: 400 });

  const sql = getSql();
  const [profile] = await sql<{ id: string }[]>`select id from profiles where username = ${username}`;
  if (profile) {
    const { error } = await getSupabaseAdmin().auth.admin.deleteUser(profile.id);
    if (error) return Response.json({ error: `Gagal menghapus akun otentikasi: ${error.message}` }, { status: 500 });
  }

  await sql`delete from profiles where username = ${username}`;
  // getSessionInvalidatedAt membaca null untuk baris yang sudah tidak ada, tapi cache-nya bisa
  // menyimpan hasil "ada" sampai 30 detik — invalidasi segera supaya token akun yang baru
  // dihapus langsung ditolak di request berikutnya, bukan menunggu TTL habis.
  revalidateTag(SESSION_TAG, { expire: 0 });
  return Response.json({ ok: true });
}
