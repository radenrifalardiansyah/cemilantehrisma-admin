import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { closableLines, isRealDate, latestActiveClosing, loadPool, todayWib } from '@/lib/closing';
import { draftToPdfData } from '@/lib/pdf/closing-pdf-data';
import { closingPdfResponse } from '@/lib/pdf/closing-pdf-server';

export const runtime = 'nodejs';

// PDF "Draf closing" (pratinjau, belum closing): hanya membaca, tidak menyimpan apa pun.
// `upTo` (yyyy-mm-dd, opsional): bagian "sudah dibayar" dibatasi tanggal bayar <= upTo (sama dengan yang ikut
// closing di dialog). Tanpa `upTo` = semua yang sudah dibayar & belum closing (kartu "HPP Belum Closing").
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'product-report', 'view');
  if (guard instanceof Response) return guard;
  const upTo = new URL(req.url).searchParams.get('upTo') || null;
  if (upTo !== null && !isRealDate(upTo)) return Response.json({ error: 'Parameter upTo harus tanggal valid (yyyy-mm-dd).' }, { status: 400 });
  try {
    const sql = getSql();
    const pool = await loadPool(sql, false);
    const latest = await latestActiveClosing(sql);
    return await closingPdfResponse(draftToPdfData({
      upTo, today: todayWib(), lastClosingTo: latest?.period_to ?? null,
      paid: upTo ? closableLines(pool.paid, upTo) : pool.paid, receivable: pool.receivable,
    }));
  } catch (err) {
    console.error('[closings/pending/pdf]', err);
    return Response.json({ error: 'Gagal membuat PDF draf closing.' }, { status: 500 });
  }
}
