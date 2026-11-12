import { describe, expect, it } from 'vitest';
import {
  buildOrderLines, buildRecapLine, closableLines, closeProblem, isRealDate, orderTotals, paidAtProblem, recapTotals, reopenProblem, sumLines, wibDate,
  type CostOf, type PoolOrderRow, type PoolPaymentRow, type PoolRecapRow,
} from './closing';

const costOf: CostOf = (stored, pid) => stored ? stored : (pid === 'p-nocost' ? 700 : 0);
// 10:00 WIB pada tanggal itu (UTC+7).
const at = (day: string, hour = 10) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00+07:00`);

function order(over: Partial<PoolOrderRow> & { qty?: number; unit?: number; cost?: number }): PoolOrderRow {
  const qty = over.qty ?? 10, unit = over.unit ?? 10_000, cost = over.cost ?? 1_000;
  return {
    id: 'o1', invoice_no: 'INV-1', customer_name: 'Budi', total: String(qty * unit), payment_status: 'lunas',
    created_at: at('2026-11-12'), paid_at: null, closing_id: null,
    items: [{ productId: 'p1', qty, price: unit, subtotal: qty * unit, costPrice: cost }],
    ...over,
  };
}
const pay = (id: string, amount: number, day: string, closing_id: string | null = null): PoolPaymentRow =>
  ({ id, order_id: 'o1', amount: String(amount), paid_at: at(day), closing_id });

describe('orderTotals', () => {
  it('penuh: qty, omzet, HPP; item tanpa productId (ongkir) tidak dihitung', () => {
    const t = orderTotals([
      { productId: 'p1', qty: 10, price: 10_000, subtotal: 100_000, costPrice: 1_000 },
      { qty: 1, price: 20_000, subtotal: 20_000 },
    ], 120_000, 1, costOf);
    expect(t).toEqual({ qty: 10, revenue: 100_000, cogs: 10_000 });
  });
  it('diskon diprorata ke omzet; HPP tidak', () => {
    const t = orderTotals([{ productId: 'p1', qty: 10, price: 10_000, subtotal: 100_000, costPrice: 1_000 }], 90_000, 1, costOf);
    expect(t).toEqual({ qty: 10, revenue: 90_000, cogs: 10_000 });
  });
  it('proporsional 50% dan fallback Harga Modal produk saat snapshot 0', () => {
    expect(orderTotals([{ productId: 'p1', qty: 10, price: 10_000, subtotal: 100_000, costPrice: 1_000 }], 100_000, 0.5, costOf))
      .toEqual({ qty: 5, revenue: 50_000, cogs: 5_000 });
    expect(orderTotals([{ productId: 'p-nocost', qty: 2, price: 5_000, subtotal: 10_000, costPrice: 0 }], 10_000, 1, costOf).cogs).toBe(1_400);
  });
  it('recapTotals memakai revenue item (atau hargaTitip x qty)', () => {
    expect(recapTotals([{ productId: 'p1', qtySold: 4, hargaTitip: 8_000, costPrice: 1_000 }, { productId: 'p1', qtySold: 1, revenue: 7_000, costPrice: 1_000 }], costOf))
      .toEqual({ qty: 5, revenue: 39_000, cogs: 5_000 });
  });
});

describe('skenario: jual 10 pcs tgl 12, 2 belum bayar', () => {
  const a = order({ id: 'a', qty: 8 });
  const b = order({ id: 'b', qty: 2, payment_status: 'belum_lunas' });

  it('closing tgl 12 = 8 pcs; 2 pcs jadi piutang', () => {
    const la = buildOrderLines(a, [], costOf);
    const lb = buildOrderLines(b, [], costOf);
    expect(lb.paid).toHaveLength(0);
    expect(lb.receivable).toMatchObject({ qty: 2, cogs: 2_000, paidDate: null });
    const closing12 = closableLines(la.paid, '2026-11-12');
    expect(sumLines(closing12)).toEqual({ count: 1, qty: 8, cogs: 8_000, revenue: 80_000 });
  });

  it('tgl 13 dibayar: belum closing = 2 pcs (tidak ikut closing tgl 12), ikut closing tgl 13', () => {
    // A sudah closing (closing_id terisi) → tidak ada di pool; B dilunasi tgl 13 lewat Tandai Lunas (paid_at).
    expect(buildOrderLines(order({ id: 'a', qty: 8, closing_id: 'c1' }), [], costOf).paid).toHaveLength(0);
    const lb = buildOrderLines(order({ id: 'b', qty: 2, payment_status: 'lunas', paid_at: at('2026-11-13') }), [], costOf);
    expect(lb.receivable).toBeNull();
    expect(lb.paid).toHaveLength(1);
    expect(lb.paid[0]).toMatchObject({ qty: 2, cogs: 2_000, txDate: '2026-11-12', paidDate: '2026-11-13' });
    expect(closableLines(lb.paid, '2026-11-12')).toHaveLength(0);
    expect(sumLines(closableLines(lb.paid, '2026-11-13')).cogs).toBe(2_000);
  });

  it('lunas sejak dibuat memakai created_at sebagai tanggal bayar', () => {
    expect(buildOrderLines(a, [], costOf).paid[0].paidDate).toBe('2026-11-12');
  });
});

describe('skenario: cicilan 50%', () => {
  const o = order({ id: 'o1', qty: 10, payment_status: 'belum_lunas' });

  it('pembayaran pertama 50% diakui proporsional; sisanya piutang', () => {
    const r = buildOrderLines(o, [pay('p1', 50_000, '2026-11-12')], costOf);
    expect(r.paid).toHaveLength(1);
    expect(r.paid[0]).toMatchObject({ kind: 'payment', paymentId: 'p1', qty: 5, cogs: 5_000, revenue: 50_000, note: 'Cicilan 50%' });
    expect(r.receivable).toMatchObject({ qty: 5, cogs: 5_000 });
  });

  it('cicilan pertama sudah closing → hanya cicilan kedua (tgl 14) yang belum closing; lunas = tak ada piutang', () => {
    const lunas = order({ id: 'o1', qty: 10, payment_status: 'lunas' });
    const r = buildOrderLines(lunas, [pay('p1', 50_000, '2026-11-12', 'c1'), pay('p2', 50_000, '2026-11-14')], costOf);
    expect(r.paid.map(l => l.paymentId)).toEqual(['p2']);
    expect(r.paid[0]).toMatchObject({ qty: 5, cogs: 5_000, paidDate: '2026-11-14' });
    expect(r.receivable).toBeNull();
    // Total HPP dua cicilan = HPP pesanan penuh (tidak dobel/hilang).
    const all = buildOrderLines(lunas, [pay('p1', 50_000, '2026-11-12'), pay('p2', 50_000, '2026-11-14')], costOf).paid;
    expect(sumLines(all).cogs).toBe(10_000);
  });
});

describe('rekap konsinyasi', () => {
  const recap = (over: Partial<PoolRecapRow>): PoolRecapRow => ({
    id: 'r1', location_name: 'Toko A', payment_status: 'lunas', created_at: at('2026-11-12'), paid_at: null, closing_id: null,
    items: [{ productId: 'p1', qtySold: 5, hargaTitip: 8_000, costPrice: 1_000 }], ...over,
  });
  it('lunas → paid, belum lunas → piutang, sudah closing → tidak muncul', () => {
    expect(buildRecapLine(recap({}), costOf).paid).toMatchObject({ kind: 'recap', qty: 5, cogs: 5_000, revenue: 40_000, paidDate: '2026-11-12' });
    expect(buildRecapLine(recap({ payment_status: 'belum_lunas' }), costOf).receivable).toMatchObject({ paidDate: null, cogs: 5_000 });
    expect(buildRecapLine(recap({ closing_id: 'c1' }), costOf)).toEqual({ paid: null, receivable: null });
    expect(buildRecapLine(recap({ paid_at: at('2026-11-15') }), costOf).paid?.paidDate).toBe('2026-11-15');
  });
});

describe('aturan closing & buka ulang', () => {
  it('closeProblem: format, masa depan, lebih awal dari closing terakhir', () => {
    expect(closeProblem('2026-11-12', '2026-11-12', null)).toBeNull();
    expect(closeProblem('2026-11-13', '2026-11-12', null)).toMatch(/masa depan/);
    expect(closeProblem('2026-11-10', '2026-11-12', '2026-11-11')).toMatch(/lebih awal/);
    expect(closeProblem('2026-11-11', '2026-11-12', '2026-11-11')).toBeNull();
    expect(closeProblem('abc', '2026-11-12', null)).toMatch(/tidak valid/);
  });

  const c = (over = {}) => ({ id: 'c2', status: 'aktif', is_opening_balance: false, period_to: '2026-11-13', ...over });
  it('buka ulang: hanya yang aktif terakhir, alasan wajib', () => {
    expect(reopenProblem({ closing: c(), latestActiveId: 'c2', isSuperAdmin: false, reason: 'salah input' })).toBeNull();
    expect(reopenProblem({ closing: c(), latestActiveId: 'c2', isSuperAdmin: false, reason: '  ' })).toMatch(/Alasan/);
    expect(reopenProblem({ closing: c({ id: 'c1' }), latestActiveId: 'c2', isSuperAdmin: true, reason: 'x' })).toMatch(/paling terakhir/);
    expect(reopenProblem({ closing: c({ status: 'dibuka_ulang' }), latestActiveId: 'c2', isSuperAdmin: true, reason: 'x' })).toMatch(/sudah dibuka ulang/);
    expect(reopenProblem({ closing: undefined, latestActiveId: null, isSuperAdmin: true, reason: 'x' })).toMatch(/tidak ditemukan/);
  });
  it('saldo awal hanya Super Admin; berurutan (setelah yang baru dibuka, baru yang lama)', () => {
    const opening = c({ id: 'c0', is_opening_balance: true });
    expect(reopenProblem({ closing: opening, latestActiveId: 'c0', isSuperAdmin: false, reason: 'x' })).toMatch(/Super Admin/);
    expect(reopenProblem({ closing: opening, latestActiveId: 'c0', isSuperAdmin: true, reason: 'x' })).toBeNull();
    expect(reopenProblem({ closing: opening, latestActiveId: 'c1', isSuperAdmin: true, reason: 'x' })).toMatch(/paling terakhir/);
  });
});

describe('skenario buka ulang: item kembali ke pool, nominal tidak hilang', () => {
  it('item yang dilepas closing_id-nya muncul lagi sebagai belum closing dan ikut closing berikutnya', () => {
    const closed = buildOrderLines(order({ id: 'a', qty: 8, closing_id: 'c1' }), [], costOf);
    expect(closed.paid).toHaveLength(0);
    const released = buildOrderLines(order({ id: 'a', qty: 8, closing_id: null }), [], costOf);
    expect(sumLines(closableLines(released.paid, '2026-11-12'))).toMatchObject({ count: 1, qty: 8, cogs: 8_000 });
  });
});

describe('wibDate', () => {
  it('menormalkan ke hari kalender WIB', () => {
    expect(wibDate(new Date('2026-11-12T20:00:00Z'))).toBe('2026-11-13'); // 03:00 WIB esok harinya
    expect(wibDate(new Date('2026-11-12T16:59:00Z'))).toBe('2026-11-12');
  });
});

// ── Tambahan QA (Syahla): celah pembulatan, batas tanggal, dan kasus tepi ──

describe('QA: pembulatan cicilan', () => {
  // Tiga cicilan 33.333 + 33.333 + 33.334 untuk pesanan Rp100.000 (1 pcs, HPP Rp100).
  const o = order({ id: 'o1', qty: 1, unit: 100_000, cost: 100, payment_status: 'lunas' });
  const pays = [pay('p1', 33_333, '2026-11-12'), pay('p2', 33_333, '2026-11-13'), pay('p3', 33_334, '2026-11-14')];

  it('jumlah HPP semua cicilan sama dengan HPP pesanan penuh (tidak ada selisih pembulatan)', () => {
    const all = buildOrderLines(o, pays, costOf).paid;
    expect(sumLines(all).cogs).toBe(orderTotals(o.items as never, 100_000, 1, costOf).cogs);
  });

  it('jumlah qty semua cicilan sama dengan qty pesanan penuh', () => {
    const all = buildOrderLines(o, pays, costOf).paid;
    expect(sumLines(all).qty).toBe(1);
  });

  it('jumlah omzet semua cicilan sama dengan omzet pesanan penuh', () => {
    const all = buildOrderLines(o, pays, costOf).paid;
    expect(sumLines(all).revenue).toBe(100_000);
  });
});

describe('QA: kasus tepi buildOrderLines', () => {
  it('pembayaran melebihi total dibatasi 100% (tidak mengakui lebih dari pesanan)', () => {
    const o = order({ id: 'o1', qty: 10, payment_status: 'lunas' });
    const r = buildOrderLines(o, [pay('p1', 150_000, '2026-11-12')], costOf);
    expect(r.paid[0]).toMatchObject({ qty: 10, cogs: 10_000, revenue: 100_000 });
  });

  it('total pesanan 0 (gratis) dengan cicilan tidak menghasilkan HPP/qty maupun NaN', () => {
    const o = order({ id: 'o1', qty: 3, unit: 0, total: '0', payment_status: 'lunas' });
    const r = buildOrderLines(o, [pay('p1', 0, '2026-11-12')], costOf);
    expect(r.paid[0].cogs).toBe(0);
    expect(Number.isNaN(r.paid[0].qty)).toBe(false);
  });

  it('kolom items berbentuk string JSON (jsonb dari driver) tetap terbaca', () => {
    const o = order({ id: 'o1', qty: 4 });
    const asString = { ...o, items: JSON.stringify(o.items) };
    expect(buildOrderLines(asString, [], costOf).paid[0]).toMatchObject({ qty: 4, cogs: 4_000 });
  });

  it('pesanan lunas yang semua cicilannya sudah closing tidak menghasilkan baris maupun piutang', () => {
    const o = order({ id: 'o1', qty: 10, payment_status: 'lunas' });
    const r = buildOrderLines(o, [pay('p1', 50_000, '2026-11-12', 'c1'), pay('p2', 50_000, '2026-11-13', 'c1')], costOf);
    expect(r.paid).toHaveLength(0);
    expect(r.receivable).toBeNull();
  });

  it('pesanan belum lunas yang semua cicilannya sudah closing hanya menyisakan piutang porsi sisa', () => {
    const o = order({ id: 'o1', qty: 10, payment_status: 'belum_lunas' });
    const r = buildOrderLines(o, [pay('p1', 30_000, '2026-11-12', 'c1')], costOf);
    expect(r.paid).toHaveLength(0);
    expect(r.receivable).toMatchObject({ qty: 7, cogs: 7_000, note: 'Sisa 70%' });
  });
});

describe('QA: batas tanggal WIB', () => {
  it('transaksi 23:30 WIB tgl 12 dibayar 00:30 WIB tgl 13: tanggal bayar = 13, tidak ikut closing tgl 12', () => {
    const o = order({ id: 'o1', qty: 2, created_at: at('2026-11-12', 23), payment_status: 'lunas', paid_at: new Date('2026-11-13T00:30:00+07:00') });
    const l = buildOrderLines(o, [], costOf).paid[0];
    expect(l).toMatchObject({ txDate: '2026-11-12', paidDate: '2026-11-13' });
    expect(closableLines([l], '2026-11-12')).toHaveLength(0);
  });

  it('00:00 WIB tepat sudah hari baru; 23:59:59 WIB masih hari lama', () => {
    expect(wibDate(new Date('2026-11-12T17:00:00Z'))).toBe('2026-11-13');
    expect(wibDate(new Date('2026-11-12T16:59:59Z'))).toBe('2026-11-12');
  });

  it('pergantian bulan dan tahun', () => {
    expect(wibDate(new Date('2026-12-31T17:00:00Z'))).toBe('2027-01-01');
    expect(wibDate(new Date('2026-11-30T17:00:00Z'))).toBe('2026-12-01');
  });

  it('closableLines: batas inklusif, baris piutang (paidDate null) tidak pernah ikut', () => {
    const base = { kind: 'order' as const, key: 'k', invoiceNo: '', party: '', txDate: '2026-11-12', qty: 1, cogs: 1, revenue: 1 };
    const lines = [{ ...base, paidDate: '2026-11-12' }, { ...base, paidDate: '2026-11-13' }, { ...base, paidDate: null }];
    expect(closableLines(lines, '2026-11-12').map(l => l.paidDate)).toEqual(['2026-11-12']);
    expect(closableLines(lines, '2026-12-31').map(l => l.paidDate)).toEqual(['2026-11-12', '2026-11-13']);
  });

  it('cicilan dibayar di tanggal setelah closing terakhir tidak ikut closing yang sudah lewat', () => {
    const o = order({ id: 'o1', qty: 10, payment_status: 'belum_lunas' });
    const r = buildOrderLines(o, [pay('p1', 50_000, '2026-11-12'), pay('p2', 50_000, '2026-11-14')], costOf);
    expect(closableLines(r.paid, '2026-11-13').map(l => l.paymentId)).toEqual(['p1']);
  });
});

describe('QA: closeProblem', () => {
  it('tanggal kalender yang tidak ada (31 Februari) ditolak', () => {
    expect(closeProblem('2026-02-31', '2026-11-12', null)).toMatch(/tidak valid/);
  });

  it('bulan 13 ditolak', () => {
    expect(closeProblem('2026-13-01', '2026-11-12', null)).not.toBeNull(); // ditolak (saat ini lewat jalur "masa depan", bukan "tidak valid")
  });

  it('tanggal sama dengan hari ini dan sama dengan closing terakhir diizinkan (closing ulang di hari yang sama)', () => {
    expect(closeProblem('2026-11-12', '2026-11-12', '2026-11-12')).toBeNull();
  });

  it('setelah closing terakhir dibuka ulang, closing ulang ke tanggal yang sama diizinkan', () => {
    // Closing aktif terakhir kini yang sebelumnya (11) → upTo 12 boleh lagi.
    expect(closeProblem('2026-11-12', '2026-11-12', '2026-11-11')).toBeNull();
  });
});

// ── Perbaikan pasca-review: pembulatan kumulatif, validasi tanggal, paidAt ──

describe('pembulatan cicilan (kumulatif)', () => {
  it('sebagian cicilan + piutang sisa = pesanan penuh persis', () => {
    const o = order({ id: 'o1', qty: 1, unit: 100_000, cost: 100, payment_status: 'belum_lunas' });
    const r = buildOrderLines(o, [pay('p1', 33_333, '2026-11-12'), pay('p2', 33_333, '2026-11-13')], costOf);
    const sum = sumLines([...r.paid, r.receivable!]);
    expect(sum).toMatchObject({ cogs: 100, qty: 1, revenue: 100_000 });
  });
  it('cicilan yang sudah closing tetap dihitung dalam kumulatif sehingga sisanya konsisten', () => {
    const o = order({ id: 'o1', qty: 1, unit: 100_000, cost: 100, payment_status: 'lunas' });
    const r = buildOrderLines(o, [pay('p1', 33_333, '2026-11-12', 'c1'), pay('p2', 33_333, '2026-11-13'), pay('p3', 33_334, '2026-11-14')], costOf);
    expect(r.paid.map(l => l.paymentId)).toEqual(['p2', 'p3']);
    expect(sumLines(r.paid).revenue).toBe(100_000 - 33_333);
  });
  it('pesanan lunas: cicilan terakhir menyerap sisa meski jumlah cicilan kurang dari total', () => {
    const o = order({ id: 'o1', qty: 10, payment_status: 'lunas' });
    const r = buildOrderLines(o, [pay('p1', 40_000, '2026-11-12'), pay('p2', 50_000, '2026-11-13')], costOf);
    expect(sumLines(r.paid)).toMatchObject({ qty: 10, cogs: 10_000, revenue: 100_000 });
  });
  it('pesanan 3 pcs dibayar 3 kali sama rata: qty total persis 3', () => {
    const o = order({ id: 'o1', qty: 3, unit: 10_000, payment_status: 'lunas' });
    const r = buildOrderLines(o, [pay('p1', 10_000, '2026-11-12'), pay('p2', 10_000, '2026-11-13'), pay('p3', 10_000, '2026-11-14')], costOf);
    expect(sumLines(r.paid)).toMatchObject({ qty: 3, cogs: 3_000, revenue: 30_000 });
  });
});

describe('isRealDate & closeProblem', () => {
  it('menolak tanggal yang tidak ada di kalender', () => {
    for (const d of ['2026-02-31', '2026-13-01', '2026-00-10', '2026-04-31', '2026-11-00', '2026-1-1', '']) expect(isRealDate(d)).toBe(false);
  });
  it('menerima tanggal nyata termasuk 29 Februari kabisat', () => {
    expect(isRealDate('2028-02-29')).toBe(true);
    expect(isRealDate('2026-02-29')).toBe(false);
    expect(isRealDate('2026-11-12')).toBe(true);
  });
  it('closeProblem menolak 2026-02-31 dengan pesan tidak valid', () => {
    expect(closeProblem('2026-02-31', '2026-11-12', null)).toMatch(/tidak valid/);
  });
});

describe('paidAtProblem', () => {
  const now = new Date('2026-11-12T10:00:00+07:00');
  it('hari ini dan kemarin tanpa closing: boleh', () => {
    expect(paidAtProblem(now, now, null)).toBeNull();
    expect(paidAtProblem(new Date('2026-11-11T08:00:00+07:00'), now, null)).toBeNull();
  });
  it('masa depan (tanggal WIB) ditolak; jam lebih lambat di hari yang sama boleh', () => {
    expect(paidAtProblem(new Date('2026-11-13T00:00:00+07:00'), now, null)).toMatch(/masa depan/);
    expect(paidAtProblem(new Date('2026-11-12T22:00:00+07:00'), now, null)).toBeNull();
  });
  it('batas hari memakai WIB, bukan UTC', () => {
    // 2026-11-12T17:30Z = 13 Nov 00:30 WIB → masa depan
    expect(paidAtProblem(new Date('2026-11-12T17:30:00Z'), now, null)).toMatch(/masa depan/);
  });
  it('sebelum period_to closing aktif terakhir ditolak (pesan menyebut tanggal & buka ulang); sama atau sesudahnya boleh', () => {
    const msg = paidAtProblem(new Date('2026-11-09T10:00:00+07:00'), now, '2026-11-10');
    expect(msg).toMatch(/2026-11-10/);
    expect(msg).toMatch(/buka ulang/);
    expect(paidAtProblem(new Date('2026-11-10T10:00:00+07:00'), now, '2026-11-10')).toBeNull();
    expect(paidAtProblem(new Date('2026-11-11T10:00:00+07:00'), now, '2026-11-10')).toBeNull();
  });
});
