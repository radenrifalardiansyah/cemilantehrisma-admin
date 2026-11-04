// Nomor HP Indonesia untuk WhatsApp: 08xx… / 62 8xx… / +62 8xx… → 628xxxxxxxxx (total 10–13 digit).
export function normalizePhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  return d.startsWith('62') ? d : d.startsWith('0') ? '62' + d.slice(1) : '62' + d;
}

// Kosong dianggap valid (nomor opsional); format yang jelas salah (terlalu pendek/panjang, bukan 08…) ditolak.
export function isValidIdMobile(raw: string): boolean {
  if (!raw.trim()) return true;
  return /^628\d{8,11}$/.test(normalizePhone(raw));
}

export const PHONE_FORMAT_HINT = 'Format nomor HP tidak valid. Contoh: 081234567890 (10–13 digit, diawali 08 atau 62).';
