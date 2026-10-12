import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { seq } from '@/lib/db-seq';
import { requirePermission } from '@/lib/rbac';
import { wibDayStart, wibDayEnd } from '@/lib/date';
import { DATE_RE } from '@/lib/consign-settlement';

// Analitik Titip Jual & Lapak (dashboard → Analitik Lapak): tren, perbandingan periode sebelumnya, jam & hari ramai,
// metode bayar, produk/penitip/lapak teratas, hak penitip, dan kesehatan stok. Data lapak terpisah dari laporan toko.
// Izin: Titip Jual ('consign') atau Laporan Penjualan Lapak ('stall-report').
const addDays = (key: string, n: number) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
const N = (v: string | number | null | undefined) => Number(v ?? 0) || 0;

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, ['consign', 'stall-report'], 'view');
  if (guard instanceof Response) return guard;
  const sp = new URL(req.url).searchParams;
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const stallId = sp.get('stallId') ?? '';
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) return Response.json({ error: 'Periode tidak valid.' }, { status: 400 });
  const span = daysBetween(from, to);
  if (span > 400) return Response.json({ error: 'Periode maksimal 400 hari.' }, { status: 400 });
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(from, -span);

  const sql = getSql();
  const stallF = stallId ? sql`and s.stall_id = ${stallId}` : sql``;
  const stallL = stallId ? sql`and l.stall_id = ${stallId}` : sql``;
  const stallI = stallId ? sql`and si.stall_id = ${stallId}` : sql``;
  const start = wibDayStart(from).toDate();
  const end = wibDayEnd(to).toDate();

  // Semua query berurutan (seq) — lewat pooler, query yang menumpuk bisa macet (lihat db-seq.ts).
  const [stallList, sales, prevSales, products] = await seq([
    sql<{ id: string; name: string }[]>`select id, name from stalls order by name`,
    sql<{ date: string; stall_id: string; stall_name: string; method: string; hr: number; dow: number; n: string; net: string; items: string }[]>`
      select s.date, s.stall_id, s.stall_name, s.payment_method as method,
             extract(hour from s.created_at at time zone 'Asia/Jakarta')::int as hr, extract(isodow from s.date::date)::int as dow,
             count(*) as n, sum(s.total - s.refund_total) as net,
             sum((select coalesce(sum((i->>'qty')::numeric - coalesce((i->>'returnedQty')::numeric, 0)), 0)
                  from jsonb_array_elements(case when jsonb_typeof(s.items) = 'array' then s.items else '[]'::jsonb end) i)) as items
      from stall_sales s where s.status = 'paid' and s.date >= ${from} and s.date <= ${to} ${stallF}
      group by s.date, s.stall_id, s.stall_name, s.payment_method, hr, dow
    `,
    sql<{ date: string; n: string; net: string }[]>`
      select s.date, count(*) as n, sum(s.total - s.refund_total) as net
      from stall_sales s where s.status = 'paid' and s.date >= ${prevFrom} and s.date <= ${prevTo} ${stallF} group by s.date
    `,
    sql<{ kind: string; pid: string; name: string; qty: string; revenue: string }[]>`
      select i->>'kind' as kind, i->>'productId' as pid, i->>'name' as name,
             sum((i->>'qty')::numeric - coalesce((i->>'returnedQty')::numeric, 0)) as qty,
             sum(((i->>'qty')::numeric - coalesce((i->>'returnedQty')::numeric, 0)) * (i->>'price')::numeric) as revenue
      from stall_sales s, jsonb_array_elements(case when jsonb_typeof(s.items) = 'array' then s.items else '[]'::jsonb end) i
      where s.status = 'paid' and s.date >= ${from} and s.date <= ${to} ${stallF}
      group by 1, 2, 3
    `,
  ]);
  const [consignors, liabilities, unpaidDocs, stock, soldByProduct, wallets] = await seq([
    sql<{ id: string; name: string; qty: string; gross: string; owed: string; ours: string }[]>`
      select l.consignor_id as id, l.consignor_name as name, sum(l.qty) as qty, sum(l.qty * l.price) as gross,
             sum(l.consignor_amount) as owed, sum(l.our_amount) as ours
      from consign_sale_lines l left join stall_sales s on s.id = l.sale_id
      where l.source = 'sale' and not l.voided and (l.sale_id is null or s.status = 'paid')
        and l.created_at >= ${start} and l.created_at <= ${end} ${stallL}
      group by l.consignor_id, l.consignor_name
    `,
    sql<{ id: string; name: string; unsettled: string }[]>`
      select l.consignor_id as id, l.consignor_name as name, sum(l.consignor_amount) as unsettled
      from consign_sale_lines l left join stall_sales s on s.id = l.sale_id
      where not l.voided and l.settlement_id is null and (l.sale_id is null or s.status = 'paid') ${stallL}
      group by l.consignor_id, l.consignor_name
    `,
    sql<{ id: string; name: string; unpaid: string }[]>`
      select consignor_id as id, consignor_name as name, sum(total_amount) as unpaid
      from consign_settlements where status = 'unpaid' ${stallId ? sql`and stall_id = ${stallId}` : sql``} group by consignor_id, consignor_name
    `,
    sql<{ stall_id: string; stall_name: string; product_id: string; name: string; consignor_name: string; stock: string; price: string; min_stock: string }[]>`
      select si.stall_id, st.name as stall_name, si.product_id, p.name, c.name as consignor_name, si.stock_qty as stock,
             coalesce(si.price, p.default_price) as price, p.min_stock
      from consign_stall_items si
      join consign_products p on p.id = si.product_id join consignors c on c.id = p.consignor_id join stalls st on st.id = si.stall_id
      where p.is_active and c.is_active ${stallI}
    `,
    sql<{ stall_id: string; product_id: string; qty: string }[]>`
      select l.stall_id, l.product_id, sum(l.qty) as qty
      from consign_sale_lines l left join stall_sales s on s.id = l.sale_id
      where l.source = 'sale' and not l.voided and (l.sale_id is null or s.status = 'paid')
        and l.created_at >= ${start} and l.created_at <= ${end} ${stallL}
      group by l.stall_id, l.product_id
    `,
    sql<{ total: string }[]>`select coalesce(sum(amount), 0) as total from stall_wallet_entries ${stallId ? sql`where stall_id = ${stallId}` : sql``}`,
  ]);

  // ── Ringkasan, tren harian, lapak, jam, hari, metode bayar ──
  let revenue = 0, count = 0, itemsSold = 0;
  const dailyMap = new Map<string, number>();
  const stallMap = new Map<string, { id: string; name: string; revenue: number; count: number }>();
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0, revenue: 0 }));
  const weekdays = Array.from({ length: 7 }, (_, i) => ({ dow: i + 1, count: 0, revenue: 0 }));
  const methodMap = new Map<string, { count: number; amount: number }>();
  for (const r of sales) {
    const net = N(r.net), n = N(r.n);
    revenue += net; count += n; itemsSold += N(r.items);
    dailyMap.set(r.date, (dailyMap.get(r.date) ?? 0) + net);
    const st = stallMap.get(r.stall_id) ?? { id: r.stall_id, name: r.stall_name, revenue: 0, count: 0 };
    st.revenue += net; st.count += n; stallMap.set(r.stall_id, st);
    hours[r.hr].count += n; hours[r.hr].revenue += net;
    weekdays[r.dow - 1].count += n; weekdays[r.dow - 1].revenue += net;
    const m = methodMap.get(r.method) ?? { count: 0, amount: 0 };
    m.count += n; m.amount += net; methodMap.set(r.method, m);
  }
  let prevRevenue = 0, prevCount = 0;
  const prevDaily = new Map<string, number>();
  for (const r of prevSales) { prevRevenue += N(r.net); prevCount += N(r.n); prevDaily.set(r.date, N(r.net)); }
  const daily = Array.from({ length: span }, (_, i) => {
    const date = addDays(from, i);
    return { date, revenue: dailyMap.get(date) ?? 0, prev: prevDaily.get(addDays(prevFrom, i)) ?? 0, prevDate: addDays(prevFrom, i) };
  });

  // ── Produk terlaris & pendapatan titipan vs produk toko ──
  const prodRows = products.map(p => ({ kind: p.kind === 'consign' ? 'consign' as const : 'own' as const, productId: p.pid, name: p.name, qty: N(p.qty), revenue: N(p.revenue) }));
  const consignRevenue = prodRows.filter(p => p.kind === 'consign').reduce((a, p) => a + p.revenue, 0);
  const ownRevenue = prodRows.filter(p => p.kind === 'own').reduce((a, p) => a + p.revenue, 0);
  const topProducts = [...prodRows].sort((a, b) => b.revenue - a.revenue).slice(0, 8);

  // ── Penitip & hak penitip ──
  const consignorRows = consignors.map(c => ({ id: c.id, name: c.name, qty: N(c.qty), gross: N(c.gross), owed: N(c.owed), ours: N(c.ours) })).sort((a, b) => b.gross - a.gross);
  const consignorShare = consignorRows.reduce((a, c) => a + c.owed, 0);
  const ourConsignShare = consignorRows.reduce((a, c) => a + c.ours, 0);
  const owedMap = new Map<string, { id: string; name: string; unsettled: number; unpaid: number }>();
  for (const l of liabilities) owedMap.set(l.id, { id: l.id, name: l.name, unsettled: N(l.unsettled), unpaid: 0 });
  for (const d of unpaidDocs) { const o = owedMap.get(d.id) ?? { id: d.id, name: d.name, unsettled: 0, unpaid: 0 }; o.unpaid = N(d.unpaid); owedMap.set(d.id, o); }
  const liabilityRows = [...owedMap.values()].map(o => ({ ...o, total: o.unsettled + o.unpaid })).filter(o => o.total > 0).sort((a, b) => b.total - a.total);

  // ── Kesehatan stok titipan (kondisi saat ini) ──
  const soldMap = new Map(soldByProduct.map(r => [`${r.stall_id}|${r.product_id}`, N(r.qty)]));
  const stockRows = stock.map(s => {
    const sold = soldMap.get(`${s.stall_id}|${s.product_id}`) ?? 0;
    return { stallName: s.stall_name, productId: s.product_id, name: s.name, consignorName: s.consignor_name, stock: N(s.stock), price: N(s.price), minStock: N(s.min_stock), sold };
  });
  const stockQty = stockRows.reduce((a, s) => a + s.stock, 0);
  const stockValue = stockRows.reduce((a, s) => a + s.stock * s.price, 0);
  const soldQty = stockRows.reduce((a, s) => a + s.sold, 0);
  const sellThroughPct = soldQty + stockQty > 0 ? Math.round((soldQty / (soldQty + stockQty)) * 100) : 0;
  const deadStock = stockRows.filter(s => s.stock > 0 && s.sold <= 0).map(s => ({ ...s, value: s.stock * s.price })).sort((a, b) => b.value - a.value);
  const lowStock = stockRows.filter(s => s.stock <= (s.minStock > 0 ? s.minStock : 0) && s.minStock > 0).sort((a, b) => a.stock - b.stock);
  const soldOut = stockRows.filter(s => s.stock <= 0 && s.sold > 0).sort((a, b) => b.sold - a.sold);

  return Response.json({
    period: { from, to, prevFrom, prevTo, days: span },
    stallOptions: stallList,
    summary: {
      revenue, prevRevenue, count, prevCount, avgTicket: count > 0 ? Math.round(revenue / count) : 0, itemsSold,
      consignRevenue, ownRevenue, consignorShare, ourConsignShare, storeIncome: ourConsignShare + ownRevenue,
      liabilityUnsettled: liabilityRows.reduce((a, o) => a + o.unsettled, 0), liabilityUnpaid: liabilityRows.reduce((a, o) => a + o.unpaid, 0),
      stockQty, stockValue, sellThroughPct, walletTotal: N(wallets[0]?.total),
      deadStockCount: deadStock.length, deadStockValue: deadStock.reduce((a, s) => a + s.value, 0),
    },
    daily,
    stalls: [...stallMap.values()].sort((a, b) => b.revenue - a.revenue),
    topProducts,
    consignors: consignorRows.slice(0, 8),
    liabilities: liabilityRows.slice(0, 8),
    hours, weekdays,
    methods: [...methodMap].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.amount - a.amount),
    deadStock: deadStock.slice(0, 8), lowStock: lowStock.slice(0, 8), soldOut: soldOut.slice(0, 8),
  });
}
