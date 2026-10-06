import { getSql } from '@/lib/db';
import { decryptSecret, hashRecoveryCode, verifyTotp } from '@/lib/totp';
import { parseJsonb } from '@/lib/db';

const MAX_FAILS = 5;
const LOCK_MS = 5 * 60 * 1000;

interface TwoFactorRow {
  totp_secret: string | null; totp_enabled: boolean; totp_recovery: unknown;
  totp_last_step: string | null; totp_fail_count: number; totp_locked_until: Date | null;
}

export type SecondFactorResult =
  | { ok: true; usedRecovery: boolean; recoveryLeft: number }
  | { ok: false; error: string; locked?: boolean };

// Verifikasi faktor kedua: kode TOTP 6 digit ATAU kode pemulihan sekali pakai. Baris profil
// dikunci (for update) dan penghitung gagal disimpan di database — jadi pembatasan percobaan
// berlaku lintas instance serverless (berbeda dengan penghitung di memori), dan dua tebakan
// bersamaan tidak bisa melewati batas.
export async function verifySecondFactor(username: string, input: string): Promise<SecondFactorResult> {
  const sql = getSql();
  return sql.begin(async tx => {
    const [row] = await tx<TwoFactorRow[]>`
      select totp_secret, totp_enabled, totp_recovery, totp_last_step, totp_fail_count, totp_locked_until
      from profiles where username = ${username} for update
    `;
    if (!row?.totp_enabled || !row.totp_secret) return { ok: false, error: 'Autentikasi 2 langkah tidak aktif untuk akun ini.' } as const;

    if (row.totp_locked_until && row.totp_locked_until.getTime() > Date.now()) {
      return { ok: false, error: 'Terlalu banyak kode salah. Coba lagi dalam beberapa menit.', locked: true } as const;
    }

    const code = input.trim();
    const recovery = (parseJsonb(row.totp_recovery ?? null) as string[] | null) ?? [];
    let usedRecovery = false;
    let step: number | null = null;
    let remaining = recovery;

    if (/^\d{3}\s?\d{3}$/.test(code)) {
      step = verifyTotp(decryptSecret(row.totp_secret), code, row.totp_last_step != null ? Number(row.totp_last_step) : null);
    } else {
      const h = hashRecoveryCode(code);
      if (recovery.includes(h)) { usedRecovery = true; remaining = recovery.filter(x => x !== h); }
    }

    if (step == null && !usedRecovery) {
      const fails = row.totp_fail_count + 1;
      if (fails >= MAX_FAILS) {
        await tx`update profiles set totp_fail_count = 0, totp_locked_until = ${new Date(Date.now() + LOCK_MS)} where username = ${username}`;
        return { ok: false, error: 'Terlalu banyak kode salah. Coba lagi dalam beberapa menit.', locked: true } as const;
      }
      await tx`update profiles set totp_fail_count = ${fails} where username = ${username}`;
      return { ok: false, error: 'Kode salah atau sudah kedaluwarsa.' } as const;
    }

    if (usedRecovery) {
      await tx`update profiles set totp_recovery = ${JSON.stringify(remaining)}, totp_fail_count = 0, totp_locked_until = null where username = ${username}`;
    } else {
      await tx`update profiles set totp_last_step = ${step}, totp_fail_count = 0, totp_locked_until = null where username = ${username}`;
    }
    return { ok: true, usedRecovery, recoveryLeft: remaining.length } as const;
  });
}
