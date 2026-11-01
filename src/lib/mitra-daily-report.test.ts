import { describe, expect, it } from 'vitest';
import { buildMitraDailyReport } from './mitra-daily-report';

// 2026-11-01 05:00 WIB = 2026-10-31 22:00 UTC
const at = (iso: string) => ({ seconds: Math.floor(new Date(`${iso}+07:00`).getTime() / 1000) });

describe('buildMitraDailyReport', () => {
  const base = {
    locations: [{ id: 'L1', name: 'BGM 1' }, { id: 'L2', name: 'BGM 2' }],
    stockByLocation: { L1: [{ productId: 'p', productName: 'Keripik', stockQty: 37, hargaTitip: 5000 }], L2: [] },
    shipments: [
      { locationId: 'L1', createdAt: at('2026-10-30T08:00:00'), items: [{ productId: 'p', productName: 'Keripik', qty: 50, hargaTitip: 5000, subtotal: 250000 }] },
      { locationId: 'L1', createdAt: at('2026-11-02T08:00:00'), items: [{ productId: 'p', productName: 'Keripik', qty: 10, hargaTitip: 5000, subtotal: 50000 }] },
    ],
    recaps: [
      { locationId: 'L1', createdAt: at('2026-11-01T05:00:00'), items: [{ productId: 'p', productName: 'Keripik', qtySold: 20, qtyRetur: 2, qtyReject: 1, hargaTitip: 5000, revenue: 100000 }] },
    ],
  };

  it('menghitung stok akhir tiap hari mundur dari stok sekarang', () => {
    const [l1] = buildMitraDailyReport({ ...base, from: '2026-10-30', to: '2026-11-02' });
    expect(l1.days.map(d => d.date)).toEqual(['2026-10-30', '2026-11-01', '2026-11-02']);
    // Sekarang 37. Setelah 2 Nov: 37. Setelah 1 Nov: 37 − 10 = 27. Setelah 30 Okt: 27 + 23 = 50.
    expect(l1.days.map(d => d.totals.stokAkhir)).toEqual([50, 27, 37]);
    expect(l1.days[1].rows[0]).toMatchObject({ kirim: 0, jual: 20, retur: 2, reject: 1, stokAkhir: 27 });
  });

  it('menghitung harga satuan, nilai kirim/rekap, selisih, dan realisasi', () => {
    const [l1] = buildMitraDailyReport({ ...base, from: '2026-10-30', to: '2026-11-02' });
    expect(l1.days[0].rows[0]).toMatchObject({ harga: 5000, kirim: 50, nilaiKirim: 250000, jual: 0, nilaiJual: 0, selisih: 250000 });
    expect(l1.days[1].rows[0]).toMatchObject({ harga: 5000, nilaiKirim: 0, nilaiJual: 100000, selisih: -100000 });
    expect(l1.totals).toEqual({ kirim: 60, nilaiKirim: 300000, jual: 20, nilaiJual: 100000, retur: 2, reject: 1, selisih: 200000 });
    expect(l1.realisasiPct).toBe(33.3);
    // Rekap produk selama periode (3 hari digabung), stok = akhir periode (2 Nov).
    expect(l1.products).toHaveLength(1);
    expect(l1.products[0]).toMatchObject({ productName: 'Keripik', kirim: 60, nilaiKirim: 300000, jual: 20, nilaiJual: 100000, selisih: 200000, stokAkhir: 37 });
    expect(l1.currentStock).toBe(37);
    // Stok awal periode (sebelum 30 Okt) = 0; akhir periode (2 Nov) = 37.
    expect(l1.stokAwalPeriode).toBe(0);
    expect(l1.stokAkhirPeriode).toBe(37);
    // Stok awal tiap hari = stok akhir hari sebelumnya: 0 → 50 → 27.
    expect(l1.days.map(d => d.totals.stokAwal)).toEqual([0, 50, 27]);
    expect(l1.products[0].stokAwal).toBe(0);
    expect(l1.currentStockValue).toBe(185000);
  });

  it('memakai tanggal WIB dan membatasi pada rentang', () => {
    const [l1, l2] = buildMitraDailyReport({ ...base, from: '2026-11-01', to: '2026-11-01' });
    expect(l1.days).toHaveLength(1);
    expect(l1.days[0].date).toBe('2026-11-01');
    expect(l1.totals).toMatchObject({ kirim: 0, jual: 20, retur: 2, reject: 1 });
    expect(l1.realisasiPct).toBeNull();
    expect(l1.days[0].totals.stokAkhir).toBe(27); // tetap memperhitungkan kirim sesudah rentang
    expect(l2.days).toEqual([]);
  });
});
