import { parseMoneyAmount } from '@/lib/money-input';

// Bagian MURNI (tanpa DB) logika status transfer closing — aman dipakai di klien dan diuji langsung.
// Akses DB-nya ada di src/lib/closing-settlement.ts.

// ── Status transfer closing ─────────────────────────────────────────────────────────────────
// Setelah closing HPP, operator mentransfer sejumlah HPP ke toko induk lewat Dompet (Transfer Antar Dompet).
// Tabel `closing_settlements` menautkan sebagian/seluruh sebuah transfer ke sebuah closing. Status DITURUNKAN
// (tidak disimpan) dari total tautan vs total_cogs. Tabel ini tidak mempengaruhi saldo dompet.
// Satu transfer boleh menutup beberapa closing; satu closing boleh dicicil beberapa transfer.
//
// Urutan kunci DB (WAJIB konsisten supaya tidak deadlock): advisory dompet asal -> baris wallet_transfers
// (for update) -> advisory 'closings' -> baris closings (for update, urut id).

export const SETTLE_TOLERANCE = 1;   // selisih sampai Rp 1 dianggap lunas
export const MAX_LINKS = 50;
const EPS = 0.005;                   // pembulatan numeric 2 desimal

export type SettlementStatus = 'belum' | 'sebagian' | 'sudah';

export class SettlementError extends Error {}

const r2 = (n: number) => Math.round(n * 100) / 100;
const rp = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;

// null = closing tak punya status transfer (saldo awal / total_cogs kosong / sudah dibuka ulang).
export function settlementStatus(
  c: { totalCogs: number | null; status: string; isOpeningBalance: boolean }, settled: number,
): SettlementStatus | null {
  if (c.isOpeningBalance || c.status !== 'aktif' || c.totalCogs == null) return null;
  if (c.totalCogs <= SETTLE_TOLERANCE) return null;   // HPP nol/sangat kecil: tak ada yang perlu ditransfer
  if (settled <= 0) return 'belum';
  return settled >= c.totalCogs - SETTLE_TOLERANCE - EPS ? 'sudah' : 'sebagian';
}

export const settlementRemaining = (totalCogs: number, settled: number) => Math.max(0, r2(totalCogs - settled));

export const SETTLEMENT_STATUS_LABEL: Record<SettlementStatus, string> = {
  belum: 'Belum ditransfer', sebagian: 'Sebagian', sudah: 'Sudah ditransfer',
};

export interface LinkInput { closingId: string; amount: number }

// Body `closingLinks` dari klien → daftar tautan bersih, atau pesan error. Id closing tak boleh dobel.
export function parseLinks(raw: unknown): { links: LinkInput[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'Format tautan closing tidak valid.' };
  if (raw.length > MAX_LINKS) return { error: `Satu transfer maksimal ditautkan ke ${MAX_LINKS} closing.` };
  const seen = new Set<string>();
  const links: LinkInput[] = [];
  for (const it of raw) {
    const o = (it ?? {}) as Record<string, unknown>;
    const closingId = typeof o.closingId === 'string' ? o.closingId : '';
    const amount = parseMoneyAmount(o.amount);
    if (!closingId) return { error: 'Closing pada tautan wajib dipilih.' };
    if (amount === null || amount <= 0) return { error: 'Nominal tautan closing harus lebih dari 0.' };
    if (seen.has(closingId)) return { error: 'Satu closing hanya boleh ditautkan sekali per transfer.' };
    seen.add(closingId);
    links.push({ closingId, amount });
  }
  return { links };
}

export interface ClosingForLink {
  id: string; status: string; isOpeningBalance: boolean; totalCogs: number | null;
  settledByOthers: number;   // total tautan closing ini dari transfer LAIN
  periodTo: string;
}

// Validasi alokasi sebuah transfer ke closing-closing: closing harus aktif & bukan saldo awal, total tautan per
// closing <= total_cogs, total tautan per transfer <= jumlah transfer.
export function allocationProblem(a: { links: LinkInput[]; transferAmount: number; closings: Map<string, ClosingForLink> }): string | null {
  let total = 0;
  for (const l of a.links) {
    if (!(l.amount > 0)) return 'Nominal tautan closing harus lebih dari 0.';
    const c = a.closings.get(l.closingId);
    if (!c) return 'Closing tidak ditemukan.';
    if (c.isOpeningBalance || c.totalCogs == null) return 'Closing saldo awal tidak punya status transfer.';
    if (c.status !== 'aktif') return `Closing sampai ${c.periodTo} sudah dibuka ulang dan tidak bisa ditautkan.`;
    const room = c.totalCogs - c.settledByOthers;
    if (l.amount > room + EPS) {
      return `Tautan ke closing sampai ${c.periodTo} melebihi HPP-nya (sisa ${rp(Math.max(0, room))}, diisi ${rp(l.amount)}).`;
    }
    total += l.amount;
  }
  if (total > a.transferAmount + EPS) {
    return `Total tautan closing (${rp(total)}) melebihi jumlah transfer (${rp(a.transferAmount)}).`;
  }
  return null;
}

// Jumlah transfer tidak boleh diturunkan di bawah total yang sudah ditautkan.
export function transferAmountProblem(newAmount: number, linkedTotal: number): string | null {
  if (newAmount < linkedTotal - EPS) {
    return `Jumlah transfer tidak boleh kurang dari ${rp(linkedTotal)} (sudah ditautkan ke closing). Lepas atau kurangi tautan closing dulu.`;
  }
  return null;
}

// Perubahan antara tautan yang ada dan yang diinginkan (set pengganti) — murni.
export interface LinkDiff {
  added: { closingId: string; amount: number }[];
  changed: { closingId: string; before: number; after: number }[];
  removed: { closingId: string; amount: number }[];
}
export function diffLinks(existing: LinkInput[], desired: LinkInput[]): LinkDiff {
  const ex = new Map(existing.map(l => [l.closingId, l.amount]));
  const de = new Map(desired.map(l => [l.closingId, l.amount]));
  const diff: LinkDiff = { added: [], changed: [], removed: [] };
  for (const [closingId, amount] of de) {
    const before = ex.get(closingId);
    if (before === undefined) diff.added.push({ closingId, amount });
    else if (Math.abs(before - amount) > EPS) diff.changed.push({ closingId, before, after: amount });
  }
  for (const [closingId, amount] of ex) if (!de.has(closingId)) diff.removed.push({ closingId, amount });
  return diff;
}
export const isEmptyDiff = (d: LinkDiff) => d.added.length + d.changed.length + d.removed.length === 0;


// ── Label periode ringkas untuk badge/pemilih: "12–13 Nov", "30 Okt–2 Nov", "13 Nov"; tahun ditulis bila
// bukan tahun `nowYear` atau rentang lintas tahun. Input yyyy-mm-dd.
const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export function closingPeriodLabel(from: string | null, to: string, nowYear: number = new Date().getFullYear()): string {
  const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return { y, m: m - 1, d }; };
  const t = parse(to);
  if (!Number.isFinite(t.y) || !MONTHS_ID[t.m]) return to;
  const yearSuffix = (y: number) => (y === nowYear ? '' : ` ${y}`);
  if (!from || from === to) return `${t.d} ${MONTHS_ID[t.m]}${yearSuffix(t.y)}`;
  const f = parse(from);
  if (!MONTHS_ID[f.m]) return to;
  if (f.y !== t.y) return `${f.d} ${MONTHS_ID[f.m]} ${f.y}–${t.d} ${MONTHS_ID[t.m]} ${t.y}`;
  if (f.m !== t.m) return `${f.d} ${MONTHS_ID[f.m]}–${t.d} ${MONTHS_ID[t.m]}${yearSuffix(t.y)}`;
  return `${f.d}–${t.d} ${MONTHS_ID[t.m]}${yearSuffix(t.y)}`;
}
