import { describe, expect, it } from 'vitest';
import { buildMitraDailyReport, describePeriod } from './mitra-daily-report';

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
    expect(l1.totals).toEqual({ kirim: 60, nilaiKirim: 300000, jual: 20, nilaiJual: 100000, retur: 2, reject: 1, selisih: 200000, transferMasuk: 0, transferKeluar: 0 });
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

  it('menjelaskan periode: tanggal dari/sampai dan jumlah hari', () => {
    expect(describePeriod('2026-11-01', '2026-11-01').text).toBe('1 November 2026 (1 hari)');
    const p = describePeriod('2026-10-30', '2026-11-02');
    expect(p.text).toBe('30 Oktober 2026 s/d 2 November 2026 (4 hari)');
    expect(p.days).toBe(4);
    expect(p.fromLong).toBe('Jumat, 30 Oktober 2026');
  });

  it('mengabaikan pengiriman draft/ditolak; status kosong (data lama) & approved tetap dihitung', () => {
    const item = (qty: number) => [{ productId: 'p', productName: 'Keripik', qty, hargaTitip: 5000, subtotal: qty * 5000 }];
    const [l1] = buildMitraDailyReport({
      ...base,
      shipments: [
        { locationId: 'L1', createdAt: at('2026-10-30T08:00:00'), status: 'approved', items: item(50) },
        { locationId: 'L1', createdAt: at('2026-10-30T09:00:00'), status: 'draft', items: item(999) },
        { locationId: 'L1', createdAt: at('2026-11-02T08:00:00'), status: 'ditolak', items: item(777) },
        { locationId: 'L1', createdAt: at('2026-11-02T09:00:00'), items: item(10) },
      ],
      from: '2026-10-30', to: '2026-11-02',
    });
    expect(l1.totals.kirim).toBe(60);
    expect(l1.days.map(d => d.totals.stokAkhir)).toEqual([50, 27, 37]);
  });

  describe('transfer stok antar mitra', () => {
    const tItem = (qty: number) => [{ productId: 'p', productName: 'Keripik', qty, hargaTitip: 5000 }];
    // L1 (stok sekarang 37) menerima 8 dari L2 pada 1 Nov dan memindahkan 3 ke L2 pada 2 Nov.
    const transfers = [
      { status: 'approved', fromLocationId: 'L2', toLocationId: 'L1', docDate: at('2026-11-01T09:00:00'), items: tItem(8) },
      { status: 'approved', fromLocationId: 'L1', toLocationId: 'L2', docDate: at('2026-11-02T09:00:00'), items: tItem(3) },
      { status: 'draft', fromLocationId: 'L2', toLocationId: 'L1', docDate: at('2026-11-02T10:00:00'), items: tItem(999) },
      { status: 'dibatalkan', fromLocationId: 'L2', toLocationId: 'L1', docDate: at('2026-11-02T11:00:00'), items: tItem(777) },
    ];

    it('hitung mundur stok akhir: stok sekarang - kirim - transfer masuk + transfer keluar + (jual+retur+reject) setelah hari itu', () => {
      const [l1] = buildMitraDailyReport({ ...base, transfers, from: '2026-10-30', to: '2026-11-02' });
      expect(l1.days.map(d => d.date)).toEqual(['2026-10-30', '2026-11-01', '2026-11-02']);
      // 2 Nov: 37. 1 Nov: 37 - 10 (kirim 2 Nov) + 3 (keluar 2 Nov) = 30. 30 Okt: 30 + 23 (rekap 1 Nov) - 8 (masuk 1 Nov) = 45.
      expect(l1.days.map(d => d.totals.stokAkhir)).toEqual([45, 30, 37]);
      // Stok awal tiap hari = stok akhir hari sebelumnya: 0 (sebelum 30 Okt: 45 - 50 kirim) -> 45 -> 30.
      expect(l1.days.map(d => d.totals.stokAwal)).toEqual([-5, 45, 30]);
    });

    it('kolom transfer terpisah dari kirim; draft/dibatalkan diabaikan', () => {
      const [l1, l2] = buildMitraDailyReport({ ...base, transfers, from: '2026-10-30', to: '2026-11-02' });
      expect(l1.days[1].rows[0]).toMatchObject({ kirim: 0, transferMasuk: 8, nilaiTransferMasuk: 40000, transferKeluar: 0, jual: 20 });
      expect(l1.days[2].rows[0]).toMatchObject({ kirim: 10, transferMasuk: 0, transferKeluar: 3, nilaiTransferKeluar: 15000 });
      expect(l1.totals).toMatchObject({ kirim: 60, transferMasuk: 8, transferKeluar: 3 });
      expect(l1.products[0]).toMatchObject({ kirim: 60, transferMasuk: 8, transferKeluar: 3 });
      expect(l1.days[2].totals).toMatchObject({ transferMasuk: 0, transferKeluar: 3 });
      // Mitra lawan (L2): arah terbalik; harinya muncul walau tak ada kirim/rekap.
      expect(l2.days.map(d => d.date)).toEqual(['2026-11-01', '2026-11-02']);
      expect(l2.days[0].rows[0]).toMatchObject({ transferKeluar: 8, transferMasuk: 0 });
      expect(l2.totals).toMatchObject({ transferMasuk: 3, transferKeluar: 8 });
    });

    it('tanpa transfers (klien lama): hasil dan kolom transfer = 0, hitungan lama tidak berubah', () => {
      const [l1] = buildMitraDailyReport({ ...base, from: '2026-10-30', to: '2026-11-02' });
      expect(l1.days.map(d => d.totals.stokAkhir)).toEqual([50, 27, 37]);
      expect(l1.totals).toMatchObject({ transferMasuk: 0, transferKeluar: 0 });
    });
  });
});
