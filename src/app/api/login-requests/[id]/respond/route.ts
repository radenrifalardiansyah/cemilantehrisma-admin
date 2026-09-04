import { NextRequest } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getSql } from '@/lib/db';
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

  // approve — cukup tandai disetujui. Sesi yang sedang aktif (yang merespons ini) TIDAK di-revoke —
  // multi-device didukung secara sengaja, approval ini murni gerbang notifikasi/audit supaya
  // pemilik akun yang tahu ada login baru, bukan mekanisme kick. Lihat /api/login-requests/[id]
  // (GET) yang mint token baru untuk perangkat yang menunggu begitu status ini approved.
  await sql`
    update login_requests set status = 'approved', responded_at = now(), responded_by = ${authUser.username}
    where id = ${id}
  `;
  return Response.json({ ok: true });
}
