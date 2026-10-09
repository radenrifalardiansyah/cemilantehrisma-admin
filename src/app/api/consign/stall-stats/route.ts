import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { seq } from '@/lib/db-seq';
import { requirePermission } from '@/lib/rbac';
import { DATE_RE } from '@/lib/consign-settlement';

const num = (v: string | null | undefined) => Number(v ?? 0);

// Statistik penjualan per lapak untuk kartu di Titip Jual → Lapak (pendapatan, transaksi, bagi hasil)
// pada rentang tanggal WIB. Penjualan yang dibatalkan tidak dihitung. Izin: 'consign' (view).
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'consign', 'view');
  if (guard instanceof Response) return guard;
  const sp = new URL(req.url).searchParams;
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return Response.json({ error: 'Periode tidak valid.' }, { status: 400 });

  const sql = getSql();
  const [sales, items, lines] = await seq([
    sql<{ stall_id: string; n: string; revenue: string; discount: string }[]>`
      select stall_id, count(*) as n, coalesce(sum(total - refund_total), 0) as revenue, coalesce(sum(discount), 0) as discount
      from stall_sales where status = 'paid' and date >= ${from} and date <= ${to} group by stall_id
    `,
    // Jumlah barang terjual & pendapatan produk toko (items bisa array jsonb atau string JSON data lama).
    sql<{ stall_id: string; qty: string; own_revenue: string }[]>`
      select s.stall_id, coalesce(sum((i->>'qty')::numeric - coalesce((i->>'returnedQty')::numeric, 0)), 0) as qty,
             coalesce(sum((i->>'price')::numeric * ((i->>'qty')::numeric - coalesce((i->>'returnedQty')::numeric, 0))) filter (where i->>'kind' = 'own'), 0) as own_revenue
      from stall_sales s,
           jsonb_array_elements(case when jsonb_typeof(s.items) = 'string' then (s.items #>> '{}')::jsonb else s.items end) i
      where s.status = 'paid' and s.date >= ${from} and s.date <= ${to} group by s.stall_id
    `,
    sql<{ stall_id: string; owed: string; ours: string }[]>`
      select l.stall_id, coalesce(sum(l.consignor_amount), 0) as owed, coalesce(sum(l.our_amount), 0) as ours
      from consign_sale_lines l left join stall_sales s on s.id = l.sale_id
      where not l.voided and (l.sale_id is null or s.status = 'paid')
        and coalesce(s.date, to_char(l.created_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD')) >= ${from}
        and coalesce(s.date, to_char(l.created_at at time zone 'Asia/Jakarta', 'YYYY-MM-DD')) <= ${to} group by l.stall_id
    `,
  ]);

  const stats: Record<string, { count: number; revenue: number; discount: number; itemsSold: number; ownRevenue: number; consignorShare: number; ourConsign: number; storeShare: number }> = {};
  const get = (id: string) => (stats[id] ??= { count: 0, revenue: 0, discount: 0, itemsSold: 0, ownRevenue: 0, consignorShare: 0, ourConsign: 0, storeShare: 0 });
  for (const r of sales) { const s = get(r.stall_id); s.count = num(r.n); s.revenue = num(r.revenue); s.discount = num(r.discount); }
  for (const r of items) { const s = get(r.stall_id); s.itemsSold = num(r.qty); s.ownRevenue = num(r.own_revenue); }
  for (const r of lines) { const s = get(r.stall_id); s.consignorShare = num(r.owed); s.ourConsign = num(r.ours); }
  // Bagian toko = produk toko + bagian toko dari titipan − diskon (diskon ditanggung toko).
  for (const s of Object.values(stats)) s.storeShare = s.ownRevenue + s.ourConsign - s.discount;
  return Response.json({ stats });
}
