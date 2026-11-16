import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { getSql } from '@/lib/db';
import { wibDateKey } from '@/lib/date';
import {
  buildReceivableItems, groupReceivablesByMitra, summarizeReceivables, type ReceivableRawRow,
} from '@/lib/mitra-receivables-core';

// Piutang Mitra: rekap belum lunas (sisa = total_revenue - pembayaran aktif > toleransi) dikelompokkan per mitra.
// Query: summary=1|true (hanya ringkasan), locationId (satu mitra). Umur piutang dari tanggal rekap (WIB). Hanya baca.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'consignment', 'view');
  if (guard instanceof Response) return guard;

  const sp = new URL(req.url).searchParams;
  const summaryOnly = ['1', 'true'].includes((sp.get('summary') ?? '').toLowerCase());
  const locationId = (sp.get('locationId') ?? '').trim() || null;

  try {
    const sql = getSql();
    const rows = await sql<{
      id: string; location_id: string; location_name: string; total_revenue: string; paid_amount: string;
      due_date: Date | null; wallet_id: string | null; created_at: Date;
    }[]>`
      select r.id, r.location_id, r.location_name, r.total_revenue, r.due_date, r.wallet_id, r.created_at,
        coalesce((select sum(p.amount) from consignment_recap_payments p where p.recap_id = r.id and not p.voided), 0) as paid_amount
      from consignment_recaps r
      where r.payment_status = 'belum_lunas'
        and (${locationId}::text is null or r.location_id = ${locationId}::text)
    `;
    const raws: ReceivableRawRow[] = rows.map(r => ({
      recapId: r.id, locationId: r.location_id, locationName: r.location_name ?? '',
      date: wibDateKey(new Date(r.created_at)), total: Number(r.total_revenue), paid: Number(r.paid_amount) || 0,
      // due_date tersimpan 00:00 UTC (07:00 WIB) untuk 'yyyy-mm-dd' -> hari kalender WIB yang sama.
      dueDate: r.due_date ? wibDateKey(new Date(r.due_date)) : null, walletId: r.wallet_id,
    }));
    const items = buildReceivableItems(raws);
    const summary = summarizeReceivables(items);
    if (summaryOnly) return Response.json({ summary });
    return Response.json({ summary, mitras: groupReceivablesByMitra(items) });
  } catch (err) {
    console.error('Gagal memuat piutang mitra', err);
    return Response.json({ error: 'Gagal memuat piutang mitra.' }, { status: 500 });
  }
}
