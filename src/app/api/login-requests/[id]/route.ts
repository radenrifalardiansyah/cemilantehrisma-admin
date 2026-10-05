import { NextRequest } from 'next/server';
import { recordLogin } from '@/lib/login-history';
import { getLoginRequest, APPROVED_TOKEN_WINDOW_MS } from '@/lib/login-requests';
import { getSql } from '@/lib/db';
import { signAdminToken, type AuthUser } from '@/lib/admin-auth';

type Ctx = { params: Promise<{ id: string }> };

// Public on purpose — the perangkat baru yang menunggu persetujuan belum punya token (itulah
// yang sedang ditunggu). `id` adalah UUID acak yang berfungsi sebagai capability token untuk
// permintaan ini secara spesifik, bukan daftar semua permintaan.
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const request = await getLoginRequest(id);
  if (!request) return Response.json({ error: 'Permintaan login tidak ditemukan.' }, { status: 404 });

  if (request.status === 'pending') {
    return Response.json({ status: 'pending' });
  }
  if (request.status === 'rejected') {
    return Response.json({ status: 'rejected', rejectReason: request.reject_reason });
  }
  if (request.status === 'expired') {
    return Response.json({ status: 'expired' });
  }

  // Persetujuan hanya berlaku sebentar — tanpa batas ini, siapa pun yang memegang id permintaan
  // bisa terus mencetak token baru dari snapshot lama (tanpa batas waktu).
  const respondedAt = request.responded_at?.getTime() ?? 0;
  if (!respondedAt || Date.now() - respondedAt > APPROVED_TOKEN_WINDOW_MS) {
    return Response.json({ status: 'expired' });
  }

  // approved — mint token baru untuk perangkat ini. Sesi yang menyetujui (di /respond) tidak
  // di-revoke, jadi keduanya aktif bersamaan (multi-device didukung secara sengaja).
  const user = request.user_payload as AuthUser;

  // Snapshot role/password-sementara diambil saat login — pastikan akunnya masih ada dan role-nya
  // belum berubah sejak itu, supaya role yang diturunkan/akun yang dihapus tidak tetap dapat token.
  const [profile] = await getSql()<{ role: string; must_change_password: boolean }[]>`
    select role, must_change_password from profiles where username = ${user.username}
  `;
  if (!profile || profile.role !== user.role) {
    return Response.json({ status: 'expired' });
  }
  user.mustChangePassword = profile.must_change_password;

  const token = signAdminToken(user);
  try {
    await recordLogin({ username: user.username, role: user.role, ip: request.ip, userAgent: request.user_agent });
  } catch {
    // Best-effort, sama seperti /api/login.
  }
  return Response.json({ status: 'approved', token, user, mustChangePassword: user.mustChangePassword });
}
