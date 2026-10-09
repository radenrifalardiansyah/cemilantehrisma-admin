import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { seq } from '@/lib/db-seq';
import { requirePermission } from '@/lib/rbac';
import { wibDayStart, wibDayEnd } from '@/lib/date';
import { DATE_RE } from '@/lib/consign-settlement';
import { rowToReceipt, type ReceiptRow } from '@/lib/consign-pg';
import { rowToAdjustment, type AdjustmentRow } from '@/lib/consign-adjustments';
import { rowToSettlement, type SettlementRow } from '@/lib/consign-settlement';

type Ctx = { params: Promise<{ id: string }> };
const num = (v: string | null | undefined) => Number(v ?? 0);

export type HistoryEvent = {
  at: number; type: 'receive' | 'return' | 'transfer' | 'adjust' | 'sale' | 'sale_return' | 'settlement' | 'payment';
  stallName: string; title: string; detail: string; amount: number | null; ref: string;
};

// Riwayat & ringkasan satu penitip pada rentang tanggal WIB: penerimaan/retur/pindah barang, penjualan
// (dan retur penjualan), penyesuaian stok, rekap dan pembayarannya — digabung jadi satu linimasa.
export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consign', 'view');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const from = sp.get('from') ?? ''; const to = sp.get('to') ?? '';
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return Response.json({ error: 'Periode tidak valid.' }, { status: 400 });
  const start = wibDayStart(from).toDate(); const end = wibDayEnd(to).toDate();

  const sql = getSql();
  const [consignor] = await sql<{ id: string; name: string }[]>`select id, name from consignors where id = ${id}`;
  if (!consignor) return Response.json({ error: 'Penitip tidak ditemukan.' }, { status: 404 });

  const [receipts, adjustments, settlements, lines] = await seq([
    sql<ReceiptRow[]>`select * from consign_receipts where consignor_id = ${id} and created_at >= ${start} and created_at <= ${end} order by created_at desc limit 500`,
    sql<AdjustmentRow[]>`select * from consign_adjustments where items @> ${sql.json([{ consignorId: id }] as never)} and created_at >= ${start} and created_at <= ${end} order by created_at desc limit 300`,
    sql<SettlementRow[]>`select * from consign_settlements where consignor_id = ${id} and (created_at >= ${start} and created_at <= ${end} or paid_at >= ${start} and paid_at <= ${end}) order by created_at desc limit 300`,
    // Penjualan & retur penjualan per transaksi (baris bagi hasil dikelompokkan per sale/retur).
    sql<{ sale_id: string | null; return_id: string | null; invoice_no: string | null; stall_name: string | null; at: Date; products: string; qty: string; amount: string }[]>`
      select l.sale_id, l.return_id, s.invoice_no, st.name as stall_name, max(l.created_at) as at,
             string_agg(l.product_name || ' ×' || trim(trailing '.' from trim(trailing '0' from abs(l.qty)::text)), ', ') as products,
             sum(l.qty) as qty, sum(l.consignor_amount) as amount
      from consign_sale_lines l
      left join stall_sales s on s.id = l.sale_id
      left join stalls st on st.id = l.stall_id
      where l.consignor_id = ${id} and l.source = 'sale' and not l.voided and l.created_at >= ${start} and l.created_at <= ${end}
      group by l.sale_id, l.return_id, s.invoice_no, st.name order by max(l.created_at) desc limit 500
    `,
  ]);
  // Ringkasan keseluruhan (tidak dibatasi periode): stok titipan sekarang & posisi hutang.
  const [stock, payable] = await seq([
    sql<{ qty: string; items: string }[]>`
      select coalesce(sum(si.stock_qty), 0) as qty, count(*) filter (where si.stock_qty > 0) as items
      from consign_stall_items si join consign_products p on p.id = si.product_id where p.consignor_id = ${id}
    `,
    sql<{ unsettled: string; unpaid: string; paid: string }[]>`
      select coalesce(sum(l.consignor_amount) filter (where l.settlement_id is null), 0) as unsettled,
             coalesce(sum(l.consignor_amount) filter (where st.status = 'unpaid'), 0) as unpaid,
             coalesce(sum(l.consignor_amount) filter (where st.status = 'paid'), 0) as paid
      from consign_sale_lines l
      left join stall_sales s on s.id = l.sale_id
      left join consign_settlements st on st.id = l.settlement_id
      where l.consignor_id = ${id} and not l.voided and (l.sale_id is null or s.status = 'paid')
    `,
  ]);

  const events: HistoryEvent[] = [];
  for (const row of receipts) {
    const r = rowToReceipt(row);
    const items = r.items.map(i => `${i.productName} ×${i.qty}`).join(', ');
    events.push({
      at: row.created_at.getTime(), type: r.kind === 'in' ? 'receive' : r.kind === 'return' ? 'return' : 'transfer', stallName: r.stallName,
      title: `${r.kind === 'in' ? 'Terima barang' : r.kind === 'return' ? 'Retur ke penitip' : `Pindah ke ${r.toStallName}`} · ${r.docNumber}`,
      detail: items, amount: null, ref: r.docNumber,
    });
  }
  for (const row of adjustments) {
    const a = rowToAdjustment(row);
    const mine = a.items.filter(i => i.consignorId === id);
    events.push({
      at: row.created_at.getTime(), type: 'adjust', stallName: a.stallName,
      title: `Penyesuaian stok (${a.kind}) · ${a.docNumber}`,
      detail: mine.map(i => `${i.productName} ${i.delta > 0 ? '+' : ''}${i.delta}`).join(', ') + (a.bearer === 'toko' ? ' · ditanggung toko' : a.bearer === 'penitip' ? ' · ditanggung penitip' : ''),
      amount: mine.reduce((s, i) => s + i.compensation, 0) || null, ref: a.docNumber,
    });
  }
  for (const l of lines) {
    const isReturn = !!l.return_id;
    events.push({
      at: l.at.getTime(), type: isReturn ? 'sale_return' : 'sale', stallName: l.stall_name ?? '',
      title: `${isReturn ? 'Retur penjualan' : 'Penjualan'} · ${l.invoice_no ?? ''}`, detail: l.products, amount: num(l.amount), ref: l.invoice_no ?? '',
    });
  }
  for (const row of settlements) {
    const s = rowToSettlement(row);
    if (row.created_at >= start && row.created_at <= end) {
      events.push({ at: row.created_at.getTime(), type: 'settlement', stallName: s.stallName, title: `Rekap dibuat · ${s.docNumber}`, detail: `${s.periodFrom} s/d ${s.periodTo} · ${s.status === 'paid' ? 'sudah dibayar' : 'belum dibayar'}`, amount: s.totalAmount, ref: s.docNumber });
    }
    if (row.paid_at && row.paid_at >= start && row.paid_at <= end) {
      events.push({ at: row.paid_at.getTime(), type: 'payment', stallName: s.stallName, title: `Pembayaran ke penitip · ${s.docNumber}`, detail: s.paidBy ? `dibayar oleh ${s.paidBy}` : '', amount: s.totalAmount, ref: s.docNumber });
    }
  }
  events.sort((a, b) => b.at - a.at);

  const sum = (f: (e: HistoryEvent) => boolean, pick: (e: HistoryEvent) => number) => events.filter(f).reduce((a, e) => a + pick(e), 0);
  return Response.json({
    consignor: { id: consignor.id, name: consignor.name },
    summary: {
      stockQty: num(stock[0].qty), stockProducts: num(stock[0].items),
      soldAmount: sum(e => e.type === 'sale' || e.type === 'sale_return', e => e.amount ?? 0),       // bagian penitip dari penjualan bersih
      receivedCount: events.filter(e => e.type === 'receive').length,
      paidAmount: sum(e => e.type === 'payment', e => e.amount ?? 0),
      unsettled: num(payable[0].unsettled), unpaid: num(payable[0].unpaid), paidTotal: num(payable[0].paid),
    },
    events,
  });
}
