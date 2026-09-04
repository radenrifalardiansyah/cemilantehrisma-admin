import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import { getSql } from '@/lib/db';
import { recordLogin } from '@/lib/login-history';
import { deriveLoginEmail, getSupabaseAdmin } from '@/lib/supabase-admin';
import { createLoginRequest } from '@/lib/login-requests';
import { PRESENCE_ONLINE_WINDOW_MS } from '@/lib/chat';

// Best-effort brute-force guard: in-memory per serverless instance, so it resets
// on cold start and isn't shared across concurrent instances/regions — not a
// hard guarantee, but it raises the bar at zero cost for this admin panel's
// realistic threat level (a handful of accounts, no budget for a shared store).
const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > MAX_ATTEMPTS;
}

interface ProfileRow { username: string; role: string; must_change_password: boolean }

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(ip)) {
    return Response.json({ error: 'Terlalu banyak percobaan login. Coba lagi dalam beberapa menit.' }, { status: 429 });
  }

  const { username, password } = await req.json() as { username: string; password: string };
  if (!username || !password) {
    return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const identifier = username.trim().toLowerCase();

  // Login-nya sendiri ke Supabase Auth (Tahap 7 migrasi, lihat plan gleaming-wondering-quokka.md)
  // — hanya untuk verifikasi password. Ini panggilan REST terpisah dari Postgres/Firestore, jadi
  // login tetap jalan walau salah satu dari keduanya lagi bermasalah.
  const { data, error } = await getSupabaseAdmin().auth.signInWithPassword({
    email: deriveLoginEmail(identifier),
    password,
  });
  if (error || !data.user) {
    return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const sql = getSql();
  const [profile] = await sql<ProfileRow[]>`
    select username, role, must_change_password from profiles where id = ${data.user.id}
  `;
  if (!profile) {
    // Akun ada di Supabase Auth tapi baris profil Postgres-nya hilang (mis. race backfill,
    // atau dihapus manual) — jangan terbitkan token untuk identitas yang tidak lengkap.
    return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  loginAttempts.delete(ip);
  const user = { username: profile.username, role: profile.role, uid: data.user.id, mustChangePassword: profile.must_change_password };
  const userAgent = req.headers.get('user-agent') || 'unknown';

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

  const token = jwt.sign(user, process.env.JWT_SECRET!, { expiresIn: '7d' });

  try {
    await recordLogin({ username: user.username, role: user.role, ip, userAgent });
  } catch {
    // Best-effort — gagal mencatat riwayat login tidak boleh menggagalkan login yang sudah valid.
  }

  return Response.json({ ok: true, token, user, mustChangePassword: profile.must_change_password });
}
