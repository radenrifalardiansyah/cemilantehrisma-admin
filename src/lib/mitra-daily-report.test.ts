import { describe, expect, it } from 'vitest';
import { buildMitraDailyReport } from './mitra-daily-report';

// 2026-11-01 05:00 WIB = 2026-10-31 22:00 UTC
const at = (iso: string) => ({ seconds: Math.floor(new Date(`${iso}+07:00`).getTime() / 1000) });

describe('buildMitraDailyReport', () => {
  const base = {
    locations: [{ id: 'L1', name: 'BGM 1' }, { id: 'L2', name: 'BGM 2' }],
    stockByLocation: { L1: [{ productId: 'p', productName: 'Keripik', stockQty: 30 }], L2: [] },
    shipments: [
      { locationId: 'L1', createdAt: at('2026-10-30T08:00:00'), items: [{ productId: 'p', productName: 'Keripik', qty: 50 }] },
      { locationId: 'L1', createdAt: at('2026-11-02T08:00:00'), items: [{ productId: 'p', productName: 'Keripik', qty: 10 }] },
    ],
    recaps: [
      { locationId: 'L1', createdAt: at('2026-11-01T05:00:00'), items: [{ productId: 'p', productName: 'Keripik', qtySold: 20, qtyRetur: 2, qtyReject: 1 }] },
    ],
  };

  it('menghitung stok akhir tiap hari mundur dari stok sekarang', () => {
    const [l1] = buildMitraDailyReport({ ...base, from: '2026-10-30', to: '2026-11-02' });
    expect(l1.days.map(d => d.date)).toEqual(['2026-10-30', '2026-11-01', '2026-11-02']);
    // Sekarang 30. Setelah 2 Nov: 30. Setelah 1 Nov: 30 − 10 = 20. Setelah 30 Okt: 20 + 23 = 43.
    expect(l1.days.map(d => d.totals.stokAkhir)).toEqual([43, 20, 30]);
    expect(l1.days[1].rows[0]).toMatchObject({ kirim: 0, jual: 20, retur: 2, reject: 1, stokAkhir: 20 });
  });

  it('memakai tanggal WIB dan membatasi pada rentang', () => {
    const [l1, l2] = buildMitraDailyReport({ ...base, from: '2026-11-01', to: '2026-11-01' });
    expect(l1.days).toHaveLength(1);
    expect(l1.days[0].date).toBe('2026-11-01');
    expect(l1.totals).toEqual({ kirim: 0, jual: 20, retur: 2, reject: 1 });
    expect(l1.days[0].totals.stokAkhir).toBe(20); // tetap memperhitungkan kirim sesudah rentang
    expect(l2.days).toEqual([]);
  });
});
