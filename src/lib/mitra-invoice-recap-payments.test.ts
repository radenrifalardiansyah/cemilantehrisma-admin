import { describe, expect, it } from 'vitest';
import { buildMitraInvoiceData, type InvoiceRecap } from './mitra-invoice';

// Invoice tagihan Mitra untuk rekap yang sudah dicicil (pembayaran sebagian).
// Sebelum fitur cicilan, ringkasan PDF selalu rekonsiliasi: revenueAll = paidValue (rekap lunas) + total (tagihan rekap belum lunas).
// PDF menampilkan baris "Total nilai penjualan", "- Sudah dibayar", dan "TOTAL YANG HARUS DIBAYAR" (MitraInvoicePDF.tsx).
const loc = { id: 'loc-1', name: 'Toko A' };
const item = { productName: 'Kue', qtySold: 10, qtyRetur: 0, qtyReject: 0, hargaTitip: 14_000, revenue: 140_000 };
const recap = (over: Partial<InvoiceRecap>): InvoiceRecap => ({
  id: 'rekap-abc123', createdAt: { seconds: 1_762_000_000 }, items: [item], totalSold: 10, totalRetur: 0, totalReject: 0,
  totalRevenue: 140_000, paymentStatus: 'belum_lunas', ...over,
});

describe('buildMitraInvoiceData: rekap ber-cicilan', () => {
  it('tagihan rekap belum lunas yang sudah dicicil = SISA piutang, bukan total rekap', () => {
    const d = buildMitraInvoiceData({ location: loc, shipments: [], recaps: [recap({ remaining: 40_000 })] });
    expect(d.total).toBe(40_000);
    expect(d.unpaid[0].totalRevenue).toBe(40_000);
  });

  it('rekap belum lunas tanpa cicilan (data lama) tetap ditagih penuh', () => {
    const d = buildMitraInvoiceData({ location: loc, shipments: [], recaps: [recap({})] });
    expect(d.total).toBe(140_000);
  });

  it('rekonsiliasi ringkasan tetap berlaku: total nilai penjualan = sudah dibayar + tagihan (cicilan 100.000 dari 140.000)', () => {
    const d = buildMitraInvoiceData({ location: loc, shipments: [], recaps: [recap({ remaining: 40_000 })] });
    // Cicilan yang sudah diterima (100.000) harus muncul di "Sudah dibayar" supaya
    // revenueAll (140.000) - paidValue = total (40.000). Sekarang paidValue hanya menghitung rekap berstatus lunas.
    expect(d.revenueAll - d.paidValue).toBe(d.total);
  });
});
