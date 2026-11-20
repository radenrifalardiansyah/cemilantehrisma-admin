// Indikator kesehatan usaha yang murni dihitung dari data toko sendiri (bukan patokan umum):
// gaji pemilik per periode, titik impas, dan perbandingan margin dengan rata-rata bulan-bulan sebelumnya.
// Murni (tanpa DB/HTTP) supaya bisa diuji.

const parseDay = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const DAY_MS = 86_400_000;
const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** Gaji pemilik untuk rentang from..to (yyyy-mm-dd, inklusif): per bulan kalender dibagi rata per hari. */
export function ownerSalaryForPeriod(monthly: number, from: string, to: string): number {
  if (!(monthly > 0) || !from || !to || from > to) return 0;
  const start = parseDay(from), end = parseDay(to);
  let total = 0;
  for (let d = start; d <= end; d += DAY_MS) {
    const dt = new Date(d);
    total += monthly / daysInMonth(dt.getUTCFullYear(), dt.getUTCMonth());
  }
  return Math.round(total);
}

/**
 * Omzet titik impas = biaya tetap / margin kotor. Biaya tetap diaproksimasi dari seluruh Beban Operasional + gaji pemilik
 * (sebagian beban operasional sebenarnya ikut omzet, jadi hasilnya sedikit konservatif/tinggi). null bila margin kotor <= 0
 * (tidak ada omzet atau jual rugi per unit, titik impas tidak ada).
 */
export function breakEvenOmzet(fixedCosts: number, omzet: number, labaKotor: number): number | null {
  if (!(omzet > 0)) return null;
  const marginKotor = labaKotor / omzet;
  if (!(marginKotor > 0)) return null;
  return Math.max(0, fixedCosts) / marginKotor;
}

export interface MonthlyPoint { month: string; pendapatan: number; labaBersih: number }
export interface MarginHistory { months: { month: string; marginPct: number; labaSetelahGaji: number }[]; avgMarginPct: number | null }

/** Margin per bulan setelah gaji pemilik; rata-rata ditimbang omzet, bulan tanpa omzet diabaikan. */
export function marginHistory(points: MonthlyPoint[], ownerSalaryMonthly: number): MarginHistory {
  const months = points.filter(p => p.pendapatan > 0).map(p => {
    const laba = p.labaBersih - Math.max(0, ownerSalaryMonthly);
    return { month: p.month, marginPct: (laba / p.pendapatan) * 100, labaSetelahGaji: laba };
  });
  const omzet = points.filter(p => p.pendapatan > 0).reduce((s, p) => s + p.pendapatan, 0);
  const laba = months.reduce((s, m) => s + m.labaSetelahGaji, 0);
  return { months, avgMarginPct: omzet > 0 ? (laba / omzet) * 100 : null };
}

/** Bulan kalender (yyyy-mm) sebelum bulan `from`, sebanyak n, dari yang terlama. */
export function previousMonths(from: string, n: number): string[] {
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < n; i++) { m--; if (m < 1) { m = 12; y--; } out.unshift(`${y}-${String(m).padStart(2, '0')}`); }
  return out;
}
