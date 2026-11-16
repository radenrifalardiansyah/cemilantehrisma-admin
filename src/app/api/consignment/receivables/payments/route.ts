import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { getSql } from '@/lib/db';
import { wibDayStart, wibDayEnd, wibDateKey } from '@/lib/date';
import { parseDateKey } from '@/lib/validate-input';
import { PAYMENTS_LIMIT, summarizeMitraPayments, type MitraPaymentRow } from '@/lib/mitra-receivables-core';

// Riwayat Pembayaran dari Mitra: semua penerimaan/cicilan rekap lintas rekap, terbaru dulu.
// Query: from, to (yyyy-mm-dd, tanggal bayar WIB), locationId (opsional), includeVoided=1|true (default tidak).
// Maks PAYMENTS_LIMIT baris; `truncated` true bila masih ada yang lebih lama (ringkasan dari baris yang dikembalikan). Hanya baca.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'consignment', 'view');
  if (guard instanceof Response) return guard;

  const sp = new URL(req.url).searchParams;
  const from = parseDateKey(sp.get('from'), false);
  const to = parseDateKey(sp.get('to'), false);
  if ((sp.get('from') ?? '') !== '' && !from) return Response.json({ error: 'Tanggal "from" tidak valid (YYYY-MM-DD).' }, { status: 400 });
  if ((sp.get('to') ?? '') !== '' && !to) return Response.json({ error: 'Tanggal "to" tidak valid (YYYY-MM-DD).' }, { status: 400 });
  if (from && to && from > to) return Response.json({ error: 'Tanggal "from" tidak boleh setelah "to".' }, { status: 400 });
  const locationId = (sp.get('locationId') ?? '').trim() || null;
  const includeVoided = ['1', 'true'].includes((sp.get('includeVoided') ?? '').toLowerCase());
  const fromDate = from ? wibDayStart(from).toDate() : null;
  const toDate = to ? wibDayEnd(to).toDate() : null;

  try {
    const sql = getSql();
    const rows = await sql<{
      id: string; recap_id: string; location_id: string; location_name: string; amount: string; paid_at: Date;
      wallet_id: string | null; wallet_name: string | null; note: string | null; created_by: string | null; voided: boolean;
      recap_created_at: Date; total_revenue: string; created_at: Date;
    }[]>`
      select p.id, p.recap_id, r.location_id, r.location_name, p.amount, p.paid_at, p.wallet_id, w.name as wallet_name,
        p.note, p.created_by, p.voided, r.created_at as recap_created_at, r.total_revenue, p.created_at
      from consignment_recap_payments p
      join consignment_recaps r on r.id = p.recap_id
      left join wallets w on w.id = p.wallet_id
      where (${fromDate}::timestamptz is null or p.paid_at >= ${fromDate}::timestamptz)
        and (${toDate}::timestamptz is null or p.paid_at <= ${toDate}::timestamptz)
        and (${locationId}::text is null or r.location_id = ${locationId}::text)
        and (${includeVoided}::boolean or not p.voided)
      order by p.paid_at desc, p.created_at desc, p.id desc
      limit ${PAYMENTS_LIMIT + 1}
    `;
    const truncated = rows.length > PAYMENTS_LIMIT;
    const payments: MitraPaymentRow[] = rows.slice(0, PAYMENTS_LIMIT).map(r => ({
      id: r.id, recapId: r.recap_id, locationId: r.location_id, locationName: r.location_name ?? '',
      date: wibDateKey(new Date(r.paid_at)), amount: Number(r.amount),
      walletId: r.wallet_id, walletName: r.wallet_name, note: r.note ?? '', createdBy: r.created_by, voided: r.voided,
      recapDate: wibDateKey(new Date(r.recap_created_at)), recapTotal: Number(r.total_revenue),
      createdAt: new Date(r.created_at).toISOString(),
    }));
    return Response.json({ summary: summarizeMitraPayments(payments), payments, truncated, limit: PAYMENTS_LIMIT });
  } catch (err) {
    console.error('Gagal memuat riwayat pembayaran mitra', err);
    return Response.json({ error: 'Gagal memuat riwayat pembayaran.' }, { status: 500 });
  }
}
