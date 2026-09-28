import { NextRequest } from 'next/server';
import { getAuthUser, unauthorized, signAdminToken } from '@/lib/admin-auth';
import { staleSessionReason, sessionExpired } from '@/lib/rbac';

// Perpanjang sesi (sliding session) — dipanggil client saat aplikasi dibuka dan berkala selama
// dipakai (lihat page.tsx). Menerbitkan token baru dengan masa berlaku penuh (ADMIN_SESSION_TTL)
// untuk sesi yang MASIH sah, supaya pengguna aktif tidak pernah terlogout karena token kedaluwarsa.
//
// Sesi yang sudah dicabut (kick admin, ganti password/role, akun dihapus) tetap ditolak di sini
// lewat staleSessionReason — token baru hanya lahir dari token yang belum dicabut, jadi refresh
// tidak bisa dipakai untuk "menghidupkan lagi" sesi yang sudah di-revoke.
//
// Token yang masih wajib ganti password sementara tidak diperpanjang — alur itu harus selesai dulu.
export async function POST(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();
  const staleReason = await staleSessionReason(authUser);
  if (staleReason !== false) return sessionExpired(staleReason);
  if (authUser.mustChangePassword) return Response.json({ token: null });
  return Response.json({ token: signAdminToken(authUser) });
}
