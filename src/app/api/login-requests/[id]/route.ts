import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import { recordLogin } from '@/lib/login-history';
import { getLoginRequest } from '@/lib/login-requests';
import type { AuthUser } from '@/lib/admin-auth';

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

  // approved — mint token baru untuk perangkat ini. Sesi yang menyetujui (di /respond) tidak
  // di-revoke, jadi keduanya aktif bersamaan (multi-device didukung secara sengaja).
  const user = request.user_payload as AuthUser;
  const token = jwt.sign(
    { username: user.username, role: user.role, uid: user.uid, mustChangePassword: user.mustChangePassword },
    process.env.JWT_SECRET!,
    { expiresIn: '7d' },
  );
  try {
    await recordLogin({ username: user.username, role: user.role, ip: request.ip, userAgent: request.user_agent });
  } catch {
    // Best-effort, sama seperti /api/login.
  }
  return Response.json({ status: 'approved', token, user, mustChangePassword: user.mustChangePassword });
}
