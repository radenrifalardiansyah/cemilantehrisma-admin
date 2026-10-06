import { NextRequest } from 'next/server';
import QRCode from 'qrcode';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { getSql, parseJsonb } from '@/lib/db';
import { staleSessionReason, sessionExpired } from '@/lib/rbac';
import { getSettings } from '@/lib/settings-pg';
import { decryptSecret, encryptSecret, generateRecoveryCodes, generateSecret, hashRecoveryCode, otpauthUrl, verifyTotp } from '@/lib/totp';
import { verifySecondFactor } from '@/lib/two-factor-pg';

// Pengaturan autentikasi 2 langkah (TOTP) oleh pemilik akun sendiri:
//   GET                      → status
//   POST {action:'setup'}    → buat rahasia baru (belum aktif) + QR untuk dipindai aplikasi autentikator
//   POST {action:'enable'}   → aktifkan setelah kode pertama benar; mengembalikan kode pemulihan SEKALI
//   POST {action:'regenerate'} → kode pemulihan baru (kode lama hangus), butuh kode saat ini
//   POST {action:'disable'}  → matikan, butuh kode saat ini
// Reset oleh super admin untuk akun yang kehilangan perangkat: DELETE /api/users/[username]/2fa.
async function authed(req: NextRequest) {
  const user = getAuthUser(req);
  if (!user) return { error: unauthorized() };
  const stale = await staleSessionReason(user);
  if (stale !== false) return { error: sessionExpired(stale) };
  return { user };
}

interface Row { totp_enabled: boolean; totp_secret: string | null; totp_recovery: unknown }

export async function GET(req: NextRequest) {
  const a = await authed(req);
  if ('error' in a) return a.error;
  const sql = getSql();
  const [row] = await sql<Row[]>`select totp_enabled, totp_secret, totp_recovery from profiles where username = ${a.user.username}`;
  const recovery = (parseJsonb(row?.totp_recovery ?? null) as string[] | null) ?? [];
  return Response.json({ enabled: !!row?.totp_enabled, recoveryLeft: row?.totp_enabled ? recovery.length : 0 });
}

export async function POST(req: NextRequest) {
  const a = await authed(req);
  if ('error' in a) return a.error;
  const username = a.user.username;
  const { action, code } = await req.json() as { action?: string; code?: string };
  const sql = getSql();
  const [row] = await sql<Row[]>`select totp_enabled, totp_secret, totp_recovery from profiles where username = ${username}`;
  if (!row) return Response.json({ error: 'Akun tidak ditemukan.' }, { status: 404 });

  if (action === 'setup') {
    if (row.totp_enabled) return Response.json({ error: 'Autentikasi 2 langkah sudah aktif.' }, { status: 400 });
    const secret = generateSecret();
    await sql`update profiles set totp_secret = ${encryptSecret(secret)}, totp_enabled = false where username = ${username}`;
    const settings = await getSettings().catch(() => ({} as Record<string, unknown>));
    const issuer = String(settings.adminAppName ?? '').trim() || 'Admin Panel';
    const url = otpauthUrl(secret, username, issuer);
    return Response.json({ secret, otpauthUrl: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) });
  }

  if (action === 'enable') {
    if (row.totp_enabled || !row.totp_secret) return Response.json({ error: 'Mulai dari langkah setup dulu.' }, { status: 400 });
    const step = verifyTotp(decryptSecret(row.totp_secret), code ?? '', null);
    if (step == null) return Response.json({ error: 'Kode salah. Pastikan jam HP Anda akurat lalu coba lagi.' }, { status: 400 });
    const codes = generateRecoveryCodes();
    await sql`
      update profiles set totp_enabled = true, totp_last_step = ${step}, totp_recovery = ${JSON.stringify(codes.map(hashRecoveryCode))},
        totp_fail_count = 0, totp_locked_until = null where username = ${username}
    `;
    return Response.json({ ok: true, recoveryCodes: codes });
  }

  if (action === 'regenerate' || action === 'disable') {
    if (!row.totp_enabled) return Response.json({ error: 'Autentikasi 2 langkah belum aktif.' }, { status: 400 });
    const res = await verifySecondFactor(username, code ?? '');
    if (!res.ok) return Response.json({ error: res.error }, { status: res.locked ? 429 : 400 });
    if (action === 'disable') {
      await sql`
        update profiles set totp_enabled = false, totp_secret = null, totp_recovery = null, totp_last_step = null,
          totp_fail_count = 0, totp_locked_until = null where username = ${username}
      `;
      return Response.json({ ok: true });
    }
    const codes = generateRecoveryCodes();
    await sql`update profiles set totp_recovery = ${JSON.stringify(codes.map(hashRecoveryCode))} where username = ${username}`;
    return Response.json({ ok: true, recoveryCodes: codes });
  }

  return Response.json({ error: 'Aksi tidak dikenal.' }, { status: 400 });
}
