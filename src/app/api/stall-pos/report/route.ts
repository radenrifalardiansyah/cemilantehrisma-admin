import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { DATE_RE } from '@/lib/consign-settlement';

// Laporan Penjualan Lapak (menu Keuangan → Laporan; data lapak terpisah dari laporan toko). Semua angka
// berasal dari stall_sales / consign_sale_lines; penjualan yang dibatalkan tidak dihitung. Izin sendiri
// ('stall-report'), jadi bisa dibuka role keuangan tanpa akses ke Titip Jual.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'stall-report', 'view');
  if (guard instanceof Response) return guard;
  const sp = new URL(req.url).searchParams;
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const stallId = sp.get('stallId') ?? '';
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return Response.json({ error: 'Periode tidak valid.' }, { status: 400 });

  const sql = getSql();
  const stallFilter = stallId ? sql`and s.stall_id = ${stallId}` : sql``;

  const [stallList, totals, methods, daily, stalls, products, consignors] = await Promise.all([
    sql<{ id: string; name: string }[]>`select id, name from stalls order by name`,
    sql<{ n: string; revenue: string | null; discount: string | null }[]>`
      select count(*) as n, sum(total) as revenue, sum(discount) as discount
      from stall_sales s where s.status = 'paid' and s.date >= ${from} and s.date <= ${to} ${stallFilter}
    `,
    sql<{ method: string; n: string; amount: string }[]>`
      select payment_method as method, count(*) as n, sum(total) as amount
      from stall_sales s where s.status = 'paid' and s.date >= ${from} and s.date <= ${to} ${stallFilter} group by payment_method
    `,
    sql<{ date: string; n: string; revenue: string }[]>`
      select date, count(*) as n, sum(total) as revenue
      from stall_sales s where s.status = 'paid' and s.date >= ${from} and s.date <= ${to} ${stallFilter} group by date order by date
    `,
    sql<{ stall_id: string; stall_name: string; n: string; revenue: string }[]>`
      select stall_id, stall_name, count(*) as n, sum(total) as revenue
      from stall_sales s where s.status = 'paid' and s.date >= ${from} and s.date <= ${to} ${stallFilter}
      group by stall_id, stall_name order by revenue desc
    `,
    // Per barang: pendapatan kotor, jumlah, dan (khusus produk toko) HPP.
    sql<{ kind: string; product_id: string; name: string; qty: string; revenue: string; cost: string }[]>`
      select i->>'kind' as kind, i->>'productId' as product_id, i->>'name' as name,
             sum((i->>'qty')::numeric) as qty, sum((i->>'subtotal')::numeric) as revenue,
             sum(coalesce((i->>'costPrice')::numeric, 0) * (i->>'qty')::numeric) as cost
      from stall_sales s,
           -- items bisa tersimpan sebagai array jsonb (baru) atau string JSON (data lama yang ter-encode ganda)
           jsonb_array_elements(case when jsonb_typeof(s.items) = 'string' then (s.items #>> '{}')::jsonb else s.items end) i
      where s.status = 'paid' and s.date >= ${from} and s.date <= ${to} ${stallFilter}
      group by 1, 2, 3 order by revenue desc
    `,
    sql<{ consignor_id: string; consignor_name: string; sold: string; owed: string; ours: string; unsettled: string; unpaid: string; paid: string }[]>`
      select l.consignor_id, l.consignor_name,
             sum(l.price * l.qty) as sold, sum(l.consignor_amount) as owed, sum(l.our_amount) as ours,
             sum(case when l.settlement_id is null then l.consignor_amount else 0 end) as unsettled,
             sum(case when st.status = 'unpaid' then l.consignor_amount else 0 end) as unpaid,
             sum(case when st.status = 'paid' then l.consignor_amount else 0 end) as paid
      from consign_sale_lines l
      join stall_sales s on s.id = l.sale_id
      left join consign_settlements st on st.id = l.settlement_id
      where not l.voided and s.status = 'paid' and s.date >= ${from} and s.date <= ${to} ${stallFilter}
      group by l.consignor_id, l.consignor_name order by owed desc
    `,
  ]);

  const num = (v: string | null | undefined) => Number(v ?? 0);
  const ownRevenue = products.filter(p => p.kind === 'own').reduce((a, p) => a + num(p.revenue), 0);
  const ownCost = products.filter(p => p.kind === 'own').reduce((a, p) => a + num(p.cost), 0);
  const consignSold = consignors.reduce((a, c) => a + num(c.sold), 0);
  const consignorShare = consignors.reduce((a, c) => a + num(c.owed), 0);
  const ourConsign = consignors.reduce((a, c) => a + num(c.ours), 0);
  const discount = num(totals[0].discount);

  return Response.json({
    stallOptions: stallList.map(s => ({ id: s.id, name: s.name })),
    summary: {
      count: num(totals[0].n), revenue: num(totals[0].revenue), discount,
      // Bagian toko = produk toko + bagian toko dari titipan − diskon (diskon ditanggung toko).
      ownRevenue, ownCost, consignSold, consignorShare, ourConsign,
      storeShare: ownRevenue + ourConsign - discount,
      grossProfit: ownRevenue - ownCost + ourConsign - discount,
    },
    methods: methods.map(m => ({ method: m.method, count: num(m.n), amount: num(m.amount) })),
    daily: daily.map(d => ({ date: d.date, count: num(d.n), revenue: num(d.revenue) })),
    stalls: stalls.map(s => ({ stallId: s.stall_id, stallName: s.stall_name, count: num(s.n), revenue: num(s.revenue) })),
    products: products.map(p => ({ kind: p.kind, productId: p.product_id, name: p.name, qty: num(p.qty), revenue: num(p.revenue) })),
    consignors: consignors.map(c => ({
      consignorId: c.consignor_id, consignorName: c.consignor_name, sold: num(c.sold), owed: num(c.owed), ours: num(c.ours),
      unsettled: num(c.unsettled), unpaid: num(c.unpaid), paid: num(c.paid),
    })),
  });
}
