import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, decryptSecret, encryptSecret, generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode, otpauthUrl, totpCode, verifyTotp } from './totp';

// Vektor uji RFC 6238 (SHA1, rahasia ASCII "12345678901234567890"), dipotong ke 6 digit.
const SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it('cocok dengan vektor RFC 6238', () => {
    expect(totpCode(SECRET, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(SECRET, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpCode(SECRET, Math.floor(2000000000 / 30))).toBe('279037');
  });
  it('base32 bolak-balik', () => {
    const buf = Buffer.from('halo dunia');
    expect(base32Decode(base32Encode(buf)).toString()).toBe('halo dunia');
  });
  it('menerima kode langkah sekarang dan ±1, menolak yang jauh', () => {
    const now = 1111111109 * 1000;
    const step = Math.floor(1111111109 / 30);
    expect(verifyTotp(SECRET, '081804', null, now)).toBe(step);
    expect(verifyTotp(SECRET, totpCode(SECRET, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(SECRET, totpCode(SECRET, step + 5), null, now)).toBeNull();
  });
  it('menolak kode yang sudah dipakai (replay) dan format salah', () => {
    const now = 1111111109 * 1000;
    const step = Math.floor(1111111109 / 30);
    expect(verifyTotp(SECRET, '081804', step, now)).toBeNull();
    expect(verifyTotp(SECRET, '08180', null, now)).toBeNull();
    expect(verifyTotp(SECRET, 'abcdef', null, now)).toBeNull();
  });
  it('spasi di kode diabaikan', () => {
    const now = 1111111109 * 1000;
    expect(verifyTotp(SECRET, '081 804', null, now)).not.toBeNull();
  });
  it('otpauth URL memuat rahasia dan issuer', () => {
    const url = otpauthUrl('ABC234', 'rifal', 'Admin Teh Risma');
    expect(url).toContain('secret=ABC234');
    expect(url).toContain('issuer=Admin%20Teh%20Risma');
  });
});

describe('penyimpanan rahasia & kode pemulihan', () => {
  it('enkripsi bolak-balik; ciphertext berbeda tiap kali', () => {
    process.env.JWT_SECRET = 'tes-rahasia';
    const a = encryptSecret(SECRET), b = encryptSecret(SECRET);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(SECRET);
  });
  it('ciphertext yang diubah ditolak', () => {
    process.env.JWT_SECRET = 'tes-rahasia';
    const parts = encryptSecret(SECRET).split('.');
    parts[2] = Buffer.from('rusak').toString('base64');
    expect(() => decryptSecret(parts.join('.'))).toThrow();
  });
  it('kode pemulihan: format, normalisasi, hash konsisten', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    expect(codes[0]).toMatch(/^[a-f0-9]{5}-[a-f0-9]{5}$/);
    expect(normalizeRecoveryCode(' AB12C-D34EF ')).toBe('ab12cd34ef');
    expect(hashRecoveryCode(codes[0])).toBe(hashRecoveryCode(codes[0].toUpperCase().replace('-', ' ')));
  });
});
