// Helper baca nilai sel ExcelJS untuk fitur Import Excel. `cell.value` tidak selalu string/number:
// sel tanggal jadi `Date`, sel formula jadi `{ formula, result }`, sel rich text jadi `{ richText }`,
// dan sel hyperlink (mis. email yang otomatis jadi link) jadi `{ text, hyperlink }`. `String(value)`
// pada objek-objek itu menghasilkan "[object Object]" atau "Mon Sep 28 2026 07:00:00 GMT+0700 ...".

const pad = (n: number) => String(n).padStart(2, '0');

// Nilai sel → teks. Tanggal jadi yyyy-mm-dd — ExcelJS menyimpan tanggal Excel sebagai Date UTC
// (tanggal di sel = komponen UTC-nya), jadi pakai getter UTC, bukan jam lokal browser.
export function cellText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return '';
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  if (typeof value === 'object') {
    const v = value as { result?: unknown; richText?: { text: string }[]; text?: unknown; error?: unknown };
    if ('result' in v) return cellText(v.result);
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('').trim();
    if ('text' in v) return cellText(v.text);
    return '';
  }
  return String(value).trim();
}

// Teks angka format Indonesia → number. "Rp 15.000" → 15000, "1.500.000" → 1500000,
// "1,5" → 1.5, "12.500,75" → 12500.75. Titik dianggap pemisah ribuan hanya kalau polanya pas
// (grup 3 digit), supaya "1.5" (desimal gaya Inggris) tetap 1.5.
export function parseIdNumber(text: string): number {
  let s = text.replace(/[^0-9.,-]/g, '');
  if (!s) return NaN;
  const negative = s.startsWith('-');
  s = s.replace(/-/g, '');
  if (s.includes('.') && s.includes(',')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')   // 12.500,75
      : s.replace(/,/g, '');                      // 12,500.75
  } else if (s.includes('.')) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  } else if (s.includes(',')) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  const n = Number(s);
  return negative ? -n : n;
}

// Nilai sel → number. Sel angka asli (termasuk hasil formula) dipakai langsung tanpa diparse ulang,
// supaya 1.234 (desimal) tidak salah dibaca sebagai 1234.
export function cellNumber(value: unknown): number {
  if (value == null) return NaN;
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && !(value instanceof Date) && 'result' in (value as object)) {
    return cellNumber((value as { result?: unknown }).result);
  }
  return parseIdNumber(cellText(value));
}
