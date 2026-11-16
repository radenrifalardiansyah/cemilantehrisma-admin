import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { getSql } from '@/lib/db';
import { parseDateKey } from '@/lib/validate-input';
import { PAYMENTS_LIMIT, summarizeSupplierPayments, type SupplierPaymentRow } from '@/lib/supplier-payments-core';

// Riwayat Pembayaran Hutang Supplier: gabungan semua pembayaran/cicilan pembelian bahan baku, terbaru dulu.
// Query: from, to (yyyy-mm-dd, tanggal bayar), supplierId (opsional), includeVoided=1|true (default tidak).
// Pembayaran yang dibatalkan, atau milik pembelian yang dibatalkan, hanya ikut bila includeVoided. Maks PAYMENTS_LIMIT
// baris; `truncated` true bila masih ada yang lebih lama (ringkasan dihitung dari baris yang dikembalikan). Hanya baca.
// Rute statis ini diprioritaskan Next di atas segmen dinamis [id].
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'view');
  if (guard instanceof Response) return guard;

  const sp = new URL(req.url).searchParams;
  const from = parseDateKey(sp.get('from'), false);
  const to = parseDateKey(sp.get('to'), false);
  if ((sp.get('from') ?? '') !== '' && !from) return Response.json({ error: 'Tanggal "from" tidak valid (YYYY-MM-DD).' }, { status: 400 });
  if ((sp.get('to') ?? '') !== '' && !to) return Response.json({ error: 'Tanggal "to" tidak valid (YYYY-MM-DD).' }, { status: 400 });
  if (from && to && from > to) return Response.json({ error: 'Tanggal "from" tidak boleh setelah "to".' }, { status: 400 });
  const supplierId = (sp.get('supplierId') ?? sp.get('supplier') ?? '').trim() || null;
  const includeVoided = ['1', 'true'].includes((sp.get('includeVoided') ?? '').toLowerCase());

  try {
    const sql = getSql();
    const rows = await sql<{
      id: string; purchase_id: string; date: string; amount: string; supplier_id: string | null; supplier_name: string | null;
      po_number: string | null; gr_number: string | null; wallet_id: string | null; wallet_name: string | null;
      note: string | null; created_by: string | null; voided: boolean; purchase_voided: boolean; created_at: Date;
    }[]>`
      select pp.id, pp.purchase_id, pp.date, pp.amount, p.supplier_id, p.supplier_name, po.po_number, gr.gr_number,
        pp.wallet_id, w.name as wallet_name, pp.note, pp.created_by, pp.voided, p.voided as purchase_voided, pp.created_at
      from material_purchase_payments pp
      join material_purchases p on p.id = pp.purchase_id
      left join purchase_orders po on po.id = p.po_id
      left join goods_receipts gr on gr.id = p.gr_id
      left join wallets w on w.id = pp.wallet_id
      where (${from}::text is null or pp.date >= ${from}::text)
        and (${to}::text is null or pp.date <= ${to}::text)
        and (${supplierId}::text is null or p.supplier_id = ${supplierId}::text)
        and (${includeVoided}::boolean or (not pp.voided and not p.voided))
      order by pp.date desc, pp.created_at desc, pp.id desc
      limit ${PAYMENTS_LIMIT + 1}
    `;
    const truncated = rows.length > PAYMENTS_LIMIT;
    const payments: SupplierPaymentRow[] = rows.slice(0, PAYMENTS_LIMIT).map(r => ({
      id: r.id, purchaseId: r.purchase_id, date: r.date, amount: Number(r.amount),
      supplierId: r.supplier_id, supplierName: r.supplier_name ?? '', poNumber: r.po_number, grNumber: r.gr_number,
      walletId: r.wallet_id, walletName: r.wallet_name, note: r.note ?? '', createdBy: r.created_by,
      voided: r.voided || r.purchase_voided, purchaseVoided: r.purchase_voided,
      createdAt: (r.created_at instanceof Date ? r.created_at : new Date(r.created_at)).toISOString(),
    }));
    return Response.json({ summary: summarizeSupplierPayments(payments), payments, truncated, limit: PAYMENTS_LIMIT });
  } catch (err) {
    console.error('Gagal memuat riwayat pembayaran hutang supplier', err);
    return Response.json({ error: 'Gagal memuat riwayat pembayaran.' }, { status: 500 });
  }
}
