// Piutang pesanan kredit: jatuh tempo disimpan sebagai teks yyyy-mm-dd (hari kalender WIB),
// jadi dibandingkan sebagai teks/hari — bukan jam — supaya "hari ini" tidak dianggap terlambat.

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

function todayWib(now = new Date()): string {
  return new Date(now.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

function dayNumber(ymd: string): number {
  return Math.floor(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);
}

export function addDaysWib(days: number, now = new Date()): string {
  return new Date(now.getTime() + WIB_OFFSET_MS + days * 86_400_000).toISOString().slice(0, 10);
}

export function formatDueDate(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('id-ID', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
}

export type DueState = 'overdue' | 'today' | 'upcoming';

// daysLate > 0 = terlambat N hari; daysLeft = sisa hari sebelum jatuh tempo.
export function dueInfo(ymd: string | undefined | null, now = new Date()): { state: DueState; days: number } | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const diff = dayNumber(ymd) - dayNumber(todayWib(now));
  if (diff < 0) return { state: 'overdue', days: -diff };
  if (diff === 0) return { state: 'today', days: 0 };
  return { state: 'upcoming', days: diff };
}

export function isValidDueDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}
