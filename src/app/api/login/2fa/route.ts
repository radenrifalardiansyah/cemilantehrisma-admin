import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import { getSql } from '@/lib/db';
import { finishLogin, type LoginProfile } from '@/lib/login-finish';
import { verifySecondFactor } from '@/lib/two-factor-pg';

// Langkah kedua login: tukar tantangan (hasil /api/login yang password-nya benar) + kode TOTP /
// kode pemulihan dengan sesi. Pembatasan percobaan ada di database (lihat two-factor-pg.ts).
export async function POST(req: NextRequest) {
  const { challenge, code } = await req.json() as { challenge?: string; code?: string };
  if (!challenge || !code) return Response.json({ error: 'Kode wajib diisi.' }, { status: 400 });

  let uid: string;
  try {
    const payload = jwt.verify(challenge, process.env.JWT_SECRET!) as { purpose?: string; uid?: string };
    if (payload.purpose !== '2fa' || !payload.uid) throw new Error('bad purpose');
    uid = payload.uid;
  } catch {
    return Response.json({ error: 'Sesi verifikasi kedaluwarsa — silakan login ulang.', expired: true }, { status: 401 });
  }

  const sql = getSql();
  const [profile] = await sql<(LoginProfile & { totp_enabled: boolean })[]>`
    select username, role, must_change_password, totp_enabled from profiles where id = ${uid}
  `;
  if (!profile) return Response.json({ error: 'Sesi verifikasi tidak valid.', expired: true }, { status: 401 });

  const result = await verifySecondFactor(profile.username, code);
  if (!result.ok) return Response.json({ error: result.error, locked: result.locked }, { status: result.locked ? 429 : 401 });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const res = await finishLogin({ profile, uid, ip, userAgent: req.headers.get('user-agent') || 'unknown' });
  // Beri tahu klien kalau kode pemulihan terpakai & sisanya menipis, supaya bisa membuat yang baru.
  if (result.usedRecovery && res.ok) {
    const body = await res.json() as Record<string, unknown>;
    return Response.json({ ...body, recoveryLeft: result.recoveryLeft });
  }
  return res;
}
