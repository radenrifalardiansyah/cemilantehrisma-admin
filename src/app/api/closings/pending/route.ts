import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { closableLines, isRealDate, latestActiveClosing, loadPool, sumLines, todayWib } from '@/lib/closing';

const MAX_LINES = 1000;

// HPP "belum closing" untuk kartu Laporan Produk & pratinjau dialog Closing. Tidak dipengaruhi filter
// periode laporan — semua yang belum closing ditampilkan supaya tidak ada yang tercecer.
//  - paid       : sudah dibayar tapi belum closing (cicilan dihitung proporsional per pembayaran)
//  - receivable : belum dibayar (piutang; porsi sisa untuk pesanan yang dicicil)
// `upTo` (opsional, yyyy-mm-dd) → `closable` = bagian `paid` yang ikut bila closing sampai tanggal itu.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'product-report', 'view');
  if (guard instanceof Response) return guard;
  const upTo = new URL(req.url).searchParams.get('upTo') || todayWib();
  if (!isRealDate(upTo)) return Response.json({ error: 'Parameter upTo harus tanggal valid (yyyy-mm-dd).' }, { status: 400 });

  const sql = getSql();
  const pool = await loadPool(sql, false);
  const latest = await latestActiveClosing(sql);
  const byPaid = (a: { paidDate: string | null; txDate: string }, b: { paidDate: string | null; txDate: string }) =>
    (a.paidDate ?? a.txDate).localeCompare(b.paidDate ?? b.txDate);
  const paid = [...pool.paid].sort(byPaid);
  // Piutang: terbaru di atas (tanggal transaksi menurun). Dipotong MAX_LINES dari yang terbaru.
  const receivable = [...pool.receivable].sort((a, b) => b.txDate.localeCompare(a.txDate) || b.invoiceNo.localeCompare(a.invoiceNo));

  return Response.json({
    upTo, today: todayWib(), lastClosingTo: latest?.period_to ?? null,
    paid: { totals: sumLines(paid), closable: sumLines(closableLines(paid, upTo)), lines: paid.slice(0, MAX_LINES), truncated: paid.length > MAX_LINES },
    receivable: { totals: sumLines(receivable), lines: receivable.slice(0, MAX_LINES), truncated: receivable.length > MAX_LINES },
  });
}
