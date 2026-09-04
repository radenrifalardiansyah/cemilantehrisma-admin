import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getSql } from '@/lib/db';
import { SESSION_TAG } from '@/lib/rbac';
import { getLoginRequest } from '@/lib/login-requests';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();
  const { id } = await ctx.params;

  const { action, reason } = await req.json() as { action: 'approve' | 'reject'; reason?: string };
  if (action !== 'approve' && action !== 'reject') {
    return Response.json({ error: 'Aksi tidak dikenal.' }, { status: 400 });
  }

  const request = await getLoginRequest(id);
  if (!request) return Response.json({ error: 'Permintaan login tidak ditemukan.' }, { status: 404 });
  // Hanya akun yang bersangkutan (sesi yang sedang aktif) yang boleh menyetujui/menolak.
  if (request.username !== authUser.username) return Response.json({ error: 'Anda tidak dapat merespons permintaan ini.' }, { status: 403 });
  if (request.status !== 'pending') return Response.json({ error: 'Permintaan ini sudah tidak berlaku.' }, { status: 409 });

  const sql = getSql();

  if (action === 'reject') {
    const rejectReason = reason?.trim() || 'Ditolak oleh pengguna yang sedang aktif di akun ini.';
    await sql`
      update login_requests set status = 'rejected', reject_reason = ${rejectReason}, responded_at = now(), responded_by = ${authUser.username}
      where id = ${id}
    `;
    return Response.json({ ok: true });
  }

  // approve — setujui dulu, baru revoke sesi lama (termasuk sesi INI sendiri secara sengaja,
  // lihat komentar di /api/login-requests/[id]: sesi baru mint token setelah bump ini jadi
  // tidak ikut ter-revoke).
  await sql`
    update login_requests set status = 'approved', responded_at = now(), responded_by = ${authUser.username}
    where id = ${id}
  `;
  await sql`
    update profiles set
      sessions_invalidated_at = ${Math.floor(Date.now() / 1000)},
      sessions_invalidated_reason = ${`Login baru disetujui dari perangkat lain (${request.device_label}).`}
    where username = ${authUser.username}
  `;
  revalidateTag(SESSION_TAG, { expire: 0 });
  return Response.json({ ok: true });
}
