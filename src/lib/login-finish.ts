import { getSql } from '@/lib/db';
import { recordLogin } from '@/lib/login-history';
import { signAdminToken } from '@/lib/admin-auth';
import { createLoginRequest } from '@/lib/login-requests';
import { PRESENCE_ONLINE_WINDOW_MS } from '@/lib/chat';

export interface LoginProfile { username: string; role: string; must_change_password: boolean }

// Langkah terakhir login (dipakai /api/login untuk akun tanpa 2FA dan /api/login/2fa setelah kode
// benar): kalau akun sedang online di sesi lain → minta persetujuan sesi itu dulu, kalau tidak →
// terbitkan token sesi.
export async function finishLogin(opts: { profile: LoginProfile; uid: string; ip: string; userAgent: string }): Promise<Response> {
  const { profile, uid, ip, userAgent } = opts;
  const sql = getSql();
  const user = { username: profile.username, role: profile.role, uid, mustChangePassword: profile.must_change_password };

  // Akun ini sedang dipakai di sesi lain (heartbeat chat masih "hidup", lihat lib/chat.ts) —
  // jangan langsung terbitkan token baru, minta persetujuan dari sesi yang sedang aktif dulu.
  // Lihat /api/login-requests/[id] (poll perangkat ini) dan /api/login-requests/pending
  // (poll sesi aktif) untuk kelanjutan alurnya.
  const [presenceRow] = await sql<{ last_seen: Date | null }[]>`select last_seen from presence where username = ${profile.username}`;
  const alreadyOnline = !!presenceRow?.last_seen && Date.now() - presenceRow.last_seen.getTime() < PRESENCE_ONLINE_WINDOW_MS;
  if (alreadyOnline) {
    const { id, deviceLabel } = await createLoginRequest({ username: profile.username, ip, userAgent, userPayload: user });
    return Response.json({ ok: true, pending: true, requestId: id, deviceLabel });
  }

  const token = signAdminToken(user);

  try {
    await recordLogin({ username: user.username, role: user.role, ip, userAgent });
  } catch {
    // Best-effort — gagal mencatat riwayat login tidak boleh menggagalkan login yang sudah valid.
  }

  return Response.json({ ok: true, token, user, mustChangePassword: profile.must_change_password });
}
