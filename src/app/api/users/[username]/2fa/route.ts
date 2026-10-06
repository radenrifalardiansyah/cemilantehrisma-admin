import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requireSuperAdmin } from '@/lib/rbac';

type Ctx = { params: Promise<{ username: string }> };

// Reset 2FA akun yang kehilangan HP/kode pemulihan — hanya super admin. Akun itu bisa login lagi
// dengan password saja lalu mengaktifkan 2FA ulang dari profilnya.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requireSuperAdmin(req);
  if (guard instanceof Response) return guard;
  const { username } = await ctx.params;
  const sql = getSql();
  const rows = await sql`
    update profiles set totp_enabled = false, totp_secret = null, totp_recovery = null, totp_last_step = null,
      totp_fail_count = 0, totp_locked_until = null where username = ${username} returning username
  `;
  if (rows.length === 0) return Response.json({ error: 'Pengguna tidak ditemukan.' }, { status: 404 });
  return Response.json({ ok: true });
}
