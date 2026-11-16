import type postgres from 'postgres';
import { parseJsonb } from '@/lib/db';
import { wibDayStart, wibDayEnd } from '@/lib/date';
import { scaleRecapForPayment, type RecapPaymentRecord, type RecapReportItem } from '@/lib/recap-payments-core';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- lihat catatan yang sama di src/lib/wallet-balance.ts
type PgClient = postgres.ISql<{}>;

// Pembayaran Rekap Mitra yang DITERIMA dalam periode, sudah diubah jadi "rekap semu" proporsional (lihat
// scaleRecapForPayment) — dipakai laporan berbasis KAS (Laporan Keuangan, Dashboard, Analitik Bulanan) supaya uang rekap
// ber-cicilan diakui pada tanggal uangnya diterima (paid_at), sama seperti saldo dompet. Rekap yang punya pembayaran TIDAK
// ikut dihitung lewat total_revenue-nya (lihat `has_payments` di pembacanya), supaya tidak dobel.
export async function fetchRecapPaymentRecords(sql: PgClient, from: string, to: string): Promise<RecapPaymentRecord[]> {
  const rows = await sql<{
    recap_id: string; amount: string; paid_at: Date; wallet_id: string | null; location_name: string;
    total_revenue: string; other_costs: unknown; total_other_costs: string | null; items: unknown;
  }[]>`
    select p.recap_id, p.amount, p.paid_at, p.wallet_id, r.location_name, r.total_revenue, r.other_costs, r.total_other_costs, r.items
    from consignment_recap_payments p join consignment_recaps r on r.id = p.recap_id
    where not p.voided and p.paid_at >= ${wibDayStart(from).toDate()} and p.paid_at <= ${wibDayEnd(to).toDate()}
    order by p.paid_at asc
  `;
  return rows.map(r => {
    const amount = Number(r.amount);
    const scaled = scaleRecapForPayment({
      totalRevenue: Number(r.total_revenue),
      otherCosts: (parseJsonb(r.other_costs) as { label: string; amount: number }[] | null) ?? [],
      totalOtherCosts: Number(r.total_other_costs ?? 0),
      items: (parseJsonb(r.items) as RecapReportItem[] | null) ?? [],
    }, amount);
    return { recapId: r.recap_id, locationName: r.location_name, walletId: r.wallet_id, amount, paidAtSeconds: Math.floor(r.paid_at.getTime() / 1000), ...scaled };
  });
}
