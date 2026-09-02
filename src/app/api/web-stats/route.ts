import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { wibDateKey } from '@/lib/date';

const PAGE_KEYS: Record<string, string> = {
  home: '/', products: '/products', reseller: '/reseller',
  panduan: '/panduan', kontak: '/kontak', checkout: '/checkout',
};

function sanitizeKey(key: string): string {
  return key.replace(/[.~*/[\]]/g, '_');
}

// Cached for 60s — this route is hit on every dashboard load, manual refresh, and range
// toggle, and doesn't need second-fresh data for a 7/30-day trend view.
const getRawWebStats = unstable_cache(
  async (numDays: number) => {
    const sql = getSql();
    // Bucket harian di `analytics_events` (ditulis storefront lewat analyticsService.ts) kini
    // dikunci per hari kalender WIB, bukan UTC — harus dibaca pakai kunci yang sama persis, atau
    // pergantian hari UTC (07:00 WIB) membuat kunjungan dini hari salah bucket.
    const days = Array.from({ length: numDays }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - i);
      return wibDateKey(d);
    });

    const [dailyRows, deviceRows, pageRows, clickRows, [totalVisitors], prodRows, catRows] = await Promise.all([
      sql<{ day: string; views: number; visitors: number }[]>`
        select day, count(*)::int as views, count(distinct session_id)::int as visitors
        from analytics_events where kind = 'pageview' and day = any(${days}) group by day
      `,
      sql<{ device: string; n: number }[]>`
        select device, count(*)::int as n from analytics_events
        where kind = 'pageview' and day = any(${days}) group by device
      `,
      sql<{ page_key: string; n: number }[]>`
        select page_key, count(*)::int as n from analytics_events
        where kind = 'pageview' and day = any(${days}) group by page_key
      `,
      sql<{ click_type: string; click_key: string; n: number }[]>`
        select click_type, click_key, count(*)::int as n from analytics_events
        where kind = 'click' and day = any(${days}) group by click_type, click_key
      `,
      sql<{ visitors: number }[]>`
        select count(distinct session_id)::int as visitors from analytics_events
        where kind = 'pageview' and day = any(${days}) and session_id is not null
      `,
      sql<{ id: string; name: string | null; emoji: string | null; bg_color: string | null }[]>`select id, name, emoji, bg_color from products`,
      sql<{ id: string; name: string; emoji: string | null }[]>`select id, name, emoji from categories`,
    ]);

    return {
      days, dailyRows, deviceRows, pageRows, clickRows, totalVisitors,
      products: prodRows.map(r => ({ id: r.id, data: { name: r.name, emoji: r.emoji, bgColor: r.bg_color } })),
      categories: catRows.map(r => ({ id: r.id, data: { name: r.name, emoji: r.emoji } })),
    };
  },
  ['admin-web-stats'],
  { revalidate: 60 }
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'dashboard', 'view');
  if (guard instanceof Response) return guard;

  const numDays = req.nextUrl.searchParams.get('days') === '7' ? 7 : 30;
  const { days, dailyRows, deviceRows, pageRows, clickRows, totalVisitors, products, categories } = await getRawWebStats(numDays);

  const dailyMap = new Map(dailyRows.map(r => [r.day, r]));
  const daily = days.map(day => {
    const r = dailyMap.get(day);
    return { date: day, views: r?.views ?? 0, visitors: r?.visitors ?? 0 };
  });
  const pageViews = dailyRows.reduce((s, r) => s + r.views, 0);

  let mobile = 0, desktop = 0;
  for (const r of deviceRows) {
    if (r.device === 'mobile') mobile = r.n;
    else if (r.device === 'desktop') desktop = r.n;
  }

  const pageAgg: Record<string, number> = {};
  for (const r of pageRows) pageAgg[r.page_key] = r.n;

  const clickMenuAgg: Record<string, number> = {};
  const clickCategoryAgg: Record<string, number> = {};
  const clickProductAgg: Record<string, number> = {};
  const clickAddCartAgg: Record<string, number> = {};
  const CLICK_AGG: Record<string, Record<string, number>> = {
    menu: clickMenuAgg, category: clickCategoryAgg, product: clickProductAgg, addcart: clickAddCartAgg,
  };
  for (const r of clickRows) {
    const agg = CLICK_AGG[r.click_type];
    if (agg) agg[r.click_key] = r.n;
  }

  const paths = Object.entries(PAGE_KEYS)
    .map(([key, path]) => ({ path, visitors: pageAgg[key] ?? 0 }))
    .filter(p => p.visitors > 0)
    .sort((a, b) => b.visitors - a.visitors);

  const topMenu = Object.entries(PAGE_KEYS)
    .map(([key, path]) => ({ path, count: clickMenuAgg[key] ?? 0 }))
    .filter(m => m.count > 0)
    .sort((a, b) => b.count - a.count);

  const topCategories = categories
    .map(({ id, data }) => {
      const c = data as { name: string; emoji?: string };
      return { id, name: c.name, emoji: c.emoji ?? '🏷️', count: clickCategoryAgg[sanitizeKey(id)] ?? 0 };
    })
    .filter(c => c.count > 0)
    .sort((a, b) => b.count - a.count);

  const topProducts = products
    .map(({ id, data }) => {
      const p = data as { name: string; emoji?: string; bgColor?: string };
      const key = sanitizeKey(id);
      return {
        id, name: p.name, emoji: p.emoji ?? '📦', bgColor: p.bgColor ?? '#F5F0E9',
        clicks: clickProductAgg[key] ?? 0, addToCart: clickAddCartAgg[key] ?? 0,
      };
    })
    .filter(p => p.clicks > 0 || p.addToCart > 0)
    .sort((a, b) => b.clicks - a.clicks);

  return Response.json({
    stats:   { visitors: totalVisitors.visitors, pageViews },
    devices: [{ type: 'mobile', count: mobile }, { type: 'desktop', count: desktop }],
    paths,
    topMenu,
    topCategories,
    topProducts,
    daily: daily.slice(0, 7).reverse(),
  });
}
