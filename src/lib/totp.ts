import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

// TOTP (RFC 6238, HMAC-SHA1, 6 digit, langkah 30 detik) — cocok dengan Google Authenticator,
// Authy, Microsoft Authenticator, dll. Tanpa dependensi tambahan.

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

// Cocokkan kode dengan langkah sekarang ±1 (toleransi selisih jam). Mengembalikan langkah yang
// cocok, atau null. `lastStep`: langkah terakhir yang sudah dipakai — kode yang sama (atau lebih
// lama) ditolak supaya satu kode tidak bisa dipakai dua kali (replay).
export function verifyTotp(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const clean = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const cur = currentStep(now);
  for (const step of [cur, cur - 1, cur + 1]) {
    if (lastStep != null && step <= lastStep) continue;
    const expected = Buffer.from(totpCode(secret, step));
    const given = Buffer.from(clean);
    if (expected.length === given.length && timingSafeEqual(expected, given)) return step;
  }
  return null;
}

export function otpauthUrl(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

// ── Penyimpanan rahasia: AES-256-GCM, kunci diturunkan dari JWT_SECRET ────────
function key(): Buffer {
  return createHash('sha256').update(`totp:${process.env.JWT_SECRET ?? ''}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
}

export function decryptSecret(stored: string): string {
  const [iv, tag, enc] = stored.split('.').map(p => Buffer.from(p, 'base64'));
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

// ── Kode pemulihan: sekali pakai, disimpan sebagai hash ──────────────────────
export function generateRecoveryCodes(n = 8): string[] {
  return Array.from({ length: n }, () => {
    const h = randomBytes(5).toString('hex'); // 10 hex = 40 bit
    return `${h.slice(0, 5)}-${h.slice(5)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toLowerCase().replace(/[^a-f0-9]/g, '');
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}
