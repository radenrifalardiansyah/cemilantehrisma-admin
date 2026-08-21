import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDb } from '@/lib/firebase-admin';
import { recordLogin } from '@/lib/login-history';
import { deriveLoginEmail, signInWithPassword } from '@/lib/firebase-auth-rest';
import type { QueryDocumentSnapshot, DocumentSnapshot } from 'firebase-admin/firestore';

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

  // Firebase Auth path — only for username-style logins (the only kind the login form actually
  // sends; see src/app/page.tsx), since only those get a deterministic synthetic email at
  // migration time (deriveLoginEmail). This call is a REST request to identitytoolkit.
  // googleapis.com, a completely separate Google API from Firestore — a migrated account can
  // log in even while Firestore itself is fully out of quota, because role/username/
  // mustChangePassword all come back as custom claims on the idToken, not from a Firestore read.
  if (!identifier.includes('@')) {
    // Never let an unexpected throw here (network failure, bad JSON, etc.) crash the whole
    // request — that would take down login for EVERY account, migrated or not. Treat it the
    // same as any other non-credentials Firebase Auth failure: fall through to the Firestore path.
    const result = await signInWithPassword(deriveLoginEmail(identifier), password)
      .catch(err => ({ ok: false as const, reason: 'error' as const, message: err instanceof Error ? err.message : String(err) }));
    if (result.ok) {
      loginAttempts.delete(ip);
      const user = { username: identifier, role: (result.claims.role as string) ?? '', uid: result.localId };
      const token = jwt.sign(user, process.env.JWT_SECRET!, { expiresIn: '7d' });
      try {
        await recordLogin(getDb(), { username: user.username, role: user.role, ip, userAgent: req.headers.get('user-agent') || 'unknown' });
      } catch {
        // Best-effort — gagal mencatat riwayat login tidak boleh menggagalkan login yang sudah valid.
      }
      return Response.json({ ok: true, token, user, mustChangePassword: result.claims.mustChangePassword === true });
    }
    if (result.reason === 'invalid-credentials') {
      return Response.json({ error: 'Invalid credentials' }, { status: 401 });
    }
    if (result.reason === 'error') {
      // Kegagalan tak terduga dari layanan Firebase Auth sendiri (bukan salah password) — tidak
      // tahu pasti apakah akun ini sudah dimigrasikan atau belum, jadi jatuh ke jalur Firestore
      // lama di bawah sebagai fallback, sama seperti 'not-found'. Ini aman: migrateToFirebaseAuth
      // menghapus passwordHash lama begitu sebuah akun berhasil dimigrasikan, jadi fallback ini
      // tidak bisa menghidupkan lagi password pra-migrasi untuk akun yang sudah dipindahkan —
      // untuk akun yang BELUM dimigrasikan, ini cuma jalur biasa yang sudah berjalan bertahun-tahun.
      console.error('Firebase Auth signIn error, falling back to Firestore path:', result.message);
    }
    // result.reason === 'not-found' atau 'error' -> lanjut ke jalur Firestore + bcrypt lama di bawah.
  }

  // Jalur lama (Firestore + bcrypt) — dipakai untuk akun yang belum dimigrasikan, dan untuk
  // login by-email (tidak pernah dikirim oleh form login sekarang, tapi tetap didukung).
  const db = getDb();
  let snap: QueryDocumentSnapshot | DocumentSnapshot | undefined;
  if (identifier.includes('@')) {
    const q = await db.collection('users').where('email', '==', identifier).limit(1).get();
    snap = q.docs[0];
  } else {
    const doc = await db.collection('users').doc(identifier).get();
    snap = doc.exists ? doc : undefined;
  }
  if (!snap) {
    return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const data = snap.data() as { passwordHash: string; role: string };
  const valid = await bcrypt.compare(password, data.passwordHash);
  if (!valid) {
    return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  loginAttempts.delete(ip);
  const user = { username: snap.id, role: data.role };
  const token = jwt.sign(user, process.env.JWT_SECRET!, { expiresIn: '7d' });

  try {
    await recordLogin(db, { username: user.username, role: user.role, ip, userAgent: req.headers.get('user-agent') || 'unknown' });
  } catch {
    // Best-effort — gagal mencatat riwayat login tidak boleh menggagalkan login yang sudah valid.
  }

  return Response.json({ ok: true, token, user });
}
