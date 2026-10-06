import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import jwt from 'jsonwebtoken';
import { deriveLoginEmail, getSupabaseAdmin } from '@/lib/supabase-admin';
import { finishLogin } from '@/lib/login-finish';

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

// Batas percobaan GAGAL per username (selain per IP di atas) — IP dari x-forwarded-for bisa
// dirotasi penyerang, tapi username yang diserang tetap sama. Dihitung hanya untuk percobaan yang
// gagal dan di-reset saat login berhasil, supaya pemilik akun yang sah tidak ikut terkunci hanya
// karena sering login.
const loginFailures = new Map<string, { count: number; resetAt: number }>();
const MAX_FAILURES_PER_USER = 10;

function isUserLocked(identifier: string): boolean {
  const entry = loginFailures.get(identifier);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) { loginFailures.delete(identifier); return false; }
  return entry.count >= MAX_FAILURES_PER_USER;
}

function recordFailure(identifier: string) {
  const now = Date.now();
  const entry = loginFailures.get(identifier);
  if (!entry || now > entry.resetAt) loginFailures.set(identifier, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count++;
}

interface ProfileRow { username: string; role: string; must_change_password: boolean; totp_enabled: boolean }

// Tantangan 2FA: token pendek (5 menit) yang HANYA membuktikan password sudah benar — bukan sesi.
// Ditukar jadi sesi di /api/login/2fa setelah kode kedua diverifikasi.
const TWO_FACTOR_CHALLENGE_TTL = '5m';

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
  if (isUserLocked(identifier)) {
    return Response.json({ error: 'Terlalu banyak percobaan login untuk akun ini. Coba lagi dalam beberapa menit.' }, { status: 429 });
  }

  // Login-nya sendiri ke Supabase Auth (Tahap 7 migrasi, lihat plan gleaming-wondering-quokka.md)
  // — hanya untuk verifikasi password. Ini panggilan REST terpisah dari Postgres/Firestore, jadi
  // login tetap jalan walau salah satu dari keduanya lagi bermasalah.
  const { data, error } = await getSupabaseAdmin().auth.signInWithPassword({
    email: deriveLoginEmail(identifier),
    password,
  });
  if (error || !data.user) {
    recordFailure(identifier);
    return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const sql = getSql();
  const [profile] = await sql<ProfileRow[]>`
    select username, role, must_change_password, totp_enabled from profiles where id = ${data.user.id}
  `;
  if (!profile) {
    // Akun ada di Supabase Auth tapi baris profil Postgres-nya hilang (mis. race backfill,
    // atau dihapus manual) — jangan terbitkan token untuk identitas yang tidak lengkap.
    return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  loginAttempts.delete(ip);
  loginFailures.delete(identifier);

  // Akun dengan autentikasi 2 langkah: password benar BELUM cukup — minta kode kedua dulu.
  if (profile.totp_enabled) {
    const challenge = jwt.sign({ purpose: '2fa', uid: data.user.id }, process.env.JWT_SECRET!, { expiresIn: TWO_FACTOR_CHALLENGE_TTL });
    return Response.json({ ok: true, twoFactor: true, challenge });
  }

  return finishLogin({ profile, uid: data.user.id, ip, userAgent: req.headers.get('user-agent') || 'unknown' });
}
