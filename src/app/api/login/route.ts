import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDb } from '@/lib/firebase-admin';
import { recordLogin } from '@/lib/login-history';
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

  const db = getDb();
  const identifier = username.trim().toLowerCase();

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
