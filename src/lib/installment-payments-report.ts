import type postgres from 'postgres';
import { parseJsonb } from '@/lib/db';
import { wibDayStart, wibDayEnd } from '@/lib/date';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- lihat catatan yang sama di src/lib/wallet-balance.ts
type PgClient = postgres.ISql<{}>;

// Satu penerimaan uang cicilan (order_payments) beserta data pesanannya — dipakai Laporan Keuangan
// & Dashboard supaya cicilan terhitung sebagai pendapatan/kas pada tanggal uangnya DITERIMA
// (paid_at), sama seperti saldo dompet di /api/wallets/balances. Pesanan yang punya cicilan TIDAK
// ikut dihitung lewat total pesanannya (lihat `hasPayments`), supaya tidak dobel.
export interface InstallmentPayment {
  orderId: string;
  invoiceNo: string;
  customerName: string;
  source: 'kasir' | 'portal';
  amount: number;
  paidAtSeconds: number;
  orderTotal: number;
  items: { productId?: string; name?: string; qty: number; costPrice?: number }[];
}

export async function fetchInstallmentPayments(sql: PgClient, from: string, to: string): Promise<InstallmentPayment[]> {
  const rows = await sql<{ order_id: string; invoice_no: string | null; customer_name: string; source: string; amount: string; paid_at: Date; total: string; items: unknown }[]>`
    select p.order_id, o.invoice_no, o.customer_name, o.source, p.amount, p.paid_at, o.total, o.items
    from order_payments p join orders o on o.id = p.order_id
    where p.paid_at >= ${wibDayStart(from).toDate()} and p.paid_at <= ${wibDayEnd(to).toDate()}
    order by p.paid_at asc
  `;
  return rows.map(r => ({
    orderId: r.order_id, invoiceNo: r.invoice_no ?? '', customerName: r.customer_name,
    source: r.source === 'portal' ? 'portal' : 'kasir',
    amount: Number(r.amount), paidAtSeconds: Math.floor(r.paid_at.getTime() / 1000), orderTotal: Number(r.total),
    items: (parseJsonb(r.items) as InstallmentPayment['items']) ?? [],
  }));
}

// Porsi pesanan yang "terjual" lewat satu cicilan — dipakai untuk mengakui HPP sebanding dengan
// uang yang masuk (cicilan 50% → 50% HPP pesanan itu).
export const installmentRatio = (p: Pick<InstallmentPayment, 'amount' | 'orderTotal'>) =>
  p.orderTotal > 0 ? Math.min(1, p.amount / p.orderTotal) : 0;
