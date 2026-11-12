import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { loadClosingLines } from '@/lib/closing';
import { closingToPdfData, type ClosingRecord } from '@/lib/pdf/closing-pdf-data';
import { closingPdfResponse } from '@/lib/pdf/closing-pdf-server';

export const runtime = 'nodejs';

// PDF sebuah closing yang sudah ada. Hanya baca — cukup izin 'view' Laporan Produk (tidak perlu 'close').
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission(req, 'product-report', 'view');
  if (guard instanceof Response) return guard;
  try {
    const { id } = await params;
    const sql = getSql();
    const [closing] = await sql<ClosingRecord[]>`select * from closings where id = ${id}`;
    if (!closing) return Response.json({ error: 'Closing tidak ditemukan.' }, { status: 404 });
    // Saldo awal tidak punya rincian nominal; closing yang dibuka ulang sudah kehilangan closing_id di barisnya.
    const lines = closing.is_opening_balance ? [] : await loadClosingLines(sql, id);
    return await closingPdfResponse(closingToPdfData(closing, lines));
  } catch (err) {
    console.error('[closings/pdf]', err);
    return Response.json({ error: 'Gagal membuat PDF closing.' }, { status: 500 });
  }
}
