import { describe, expect, it } from 'vitest';
import { buildRecapLines, sumLines, type CostOf, type PoolRecapPaymentRow, type PoolRecapRow } from './closing';

// Uji properti (deterministik, PRNG berbenih) untuk Closing HPP rekap ber-cicilan: berapa pun urutan/jumlah cicilan dan
// pembulatan, jumlah SEMUA baris (cicilan + piutang) harus sama dengan rekap penuh, dan menandai sebagian cicilan sebagai
// "sudah closing" tidak boleh mengubah nilai baris cicilan lain.
const costOf: CostOf = (stored) => stored ?? 0;
const at = (day: string, hour = 10) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00+07:00`);
function rng(seed: number) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; }

function recapOf(total: number, status: 'lunas' | 'belum_lunas', rand: () => number): PoolRecapRow {
  // 3 item dengan qty/harga/HPP acak supaya pembulatan per item ikut diuji.
  const items = [0, 1, 2].map(i => {
    const qty = 1 + Math.floor(rand() * 37), cost = 100 + Math.floor(rand() * 4_000);
    return { productId: `p${i}`, qtySold: qty, revenue: 0, costPrice: cost };
  });
  const per = Math.floor(total / 3);
  items[0].revenue = per; items[1].revenue = per; items[2].revenue = total - 2 * per;
  return { id: 'r1', location_name: 'Toko', items, payment_status: status, created_at: at('2026-11-01'), paid_at: null, closing_id: null, total_revenue: String(total) };
}

describe('buildRecapLines: properti penjumlahan (tanpa dobel / hilang)', () => {
  it('rekap lunas lewat N cicilan: total semua baris = rekap penuh (qty, omzet, HPP), tanpa piutang', () => {
    const rand = rng(7);
    for (let t = 0; t < 300; t++) {
      const total = 10_000 + Math.floor(rand() * 990_000);
      const n = 1 + Math.floor(rand() * 5);
      const cuts = Array.from({ length: n - 1 }, () => rand()).sort();
      const bounds = [0, ...cuts.map(c => Math.max(1, Math.round(c * total))), total];
      const pays: PoolRecapPaymentRow[] = [];
      for (let i = 1; i < bounds.length; i++) {
        const amt = bounds[i] - bounds[i - 1];
        if (amt > 0) pays.push({ id: `pay${i}`, recap_id: 'r1', amount: String(amt), paid_at: at('2026-11-05', 8 + i), closing_id: null });
      }
      const rc = recapOf(total, 'lunas', rand);
      const full = sumLines(buildRecapLines(rc, [], costOf).paid);
      const r = buildRecapLines(rc, pays, costOf);
      expect(r.receivable).toBeNull();
      const s = sumLines(r.paid);
      expect(s.revenue).toBe(full.revenue);
      expect(s.cogs).toBe(full.cogs);
      expect(Math.abs(s.qty - full.qty)).toBeLessThan(0.011 * pays.length);
    }
  });

  it('rekap belum lunas ber-cicilan: baris cicilan + piutang = rekap penuh', () => {
    const rand = rng(11);
    for (let t = 0; t < 300; t++) {
      const total = 10_000 + Math.floor(rand() * 990_000);
      const paid = Math.max(1, Math.floor(total * (0.05 + rand() * 0.85)));
      const rc = recapOf(total, 'belum_lunas', rand);
      const full = sumLines(buildRecapLines({ ...rc, payment_status: 'lunas' }, [], costOf).paid);
      const half = Math.floor(paid / 2);
      const pays: PoolRecapPaymentRow[] = [
        { id: 'a', recap_id: 'r1', amount: String(half || paid), paid_at: at('2026-11-05'), closing_id: null },
        ...(half > 0 ? [{ id: 'b', recap_id: 'r1', amount: String(paid - half), paid_at: at('2026-11-06'), closing_id: null }] : []),
      ];
      const r = buildRecapLines(rc, pays, costOf);
      const s = sumLines([...r.paid, ...(r.receivable ? [r.receivable] : [])]);
      expect(s.revenue).toBe(full.revenue);
      expect(s.cogs).toBe(full.cogs);
    }
  });

  it('menandai cicilan pertama sudah closing tidak mengubah nilai cicilan kedua (nilai tetap saat closing parsial)', () => {
    const rand = rng(3);
    for (let t = 0; t < 200; t++) {
      const total = 50_000 + Math.floor(rand() * 500_000);
      const a = 1 + Math.floor(rand() * (total - 1));
      const mk = (c1: string | null): PoolRecapPaymentRow[] => [
        { id: 'a', recap_id: 'r1', amount: String(a), paid_at: at('2026-11-05'), closing_id: c1 },
        { id: 'b', recap_id: 'r1', amount: String(total - a), paid_at: at('2026-11-06'), closing_id: null },
      ];
      const rc = recapOf(total, 'lunas', rand);
      const before = buildRecapLines(rc, mk(null), costOf).paid.find(l => l.paymentId === 'b')!;
      const after = buildRecapLines(rc, mk('c1'), costOf).paid.find(l => l.paymentId === 'b')!;
      expect(after.revenue).toBe(before.revenue);
      expect(after.cogs).toBe(before.cogs);
    }
  });
});
