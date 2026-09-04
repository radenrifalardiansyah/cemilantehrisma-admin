import { NextRequest } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getSql } from '@/lib/db';
import { staleSessionReason, sessionExpired } from '@/lib/rbac';
import { getPendingRequestForUser } from '@/lib/login-requests';

// Heartbeat dipakai untuk tiga hal sekaligus, semuanya numpang di satu polling yang memang
// SUDAH jalan terus-menerus untuk setiap sesi yang login (60 detik, lihat ChatWidget.tsx) — supaya
// tidak menambah endpoint/poll baru yang menambah beban Vercel/Supabase:
// 1. Presence "online" untuk fitur chat (tujuan aslinya).
// 2. Deteksi kick/force-logout dan login-baru-disetujui (staleSessionReason).
// 3. "Ada yang mau login" untuk sesi ini — awalnya endpoint/poll terpisah (15 detik, lihat riwayat
//    LoginRequestWatcher.tsx), digabung ke sini karena poll terpisah itu jalan 24 jam untuk semua
//    sesi padahal insiden login konkuren jarang terjadi.
// Sengaja tidak lewat requirePermission (itu juga mensyaratkan suatu featureKey) — presence tidak
// terikat permission apa pun.
export async function POST(req: NextRequest) {
  const authUser = getAuthUser(req);
  if (!authUser) return unauthorized();

  const staleReason = await staleSessionReason(authUser);
  if (staleReason !== false) return sessionExpired(staleReason);

  const sql = getSql();
  const [, pendingRequest] = await Promise.all([
    sql`
      insert into presence (username, last_seen) values (${authUser.username}, now())
      on conflict (username) do update set last_seen = now()
    `,
    getPendingRequestForUser(authUser.username),
  ]);

  return Response.json({
    ok: true,
    pendingLoginRequest: pendingRequest
      ? { id: pendingRequest.id, deviceLabel: pendingRequest.device_label, ip: pendingRequest.ip }
      : null,
  });
}
