import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';

const PAGE_KEYS: Record<string, string> = {
  home: '/', products: '/products', reseller: '/reseller',
  panduan: '/panduan', kontak: '/kontak', checkout: '/checkout',
};

function sanitizeKey(key: string): string {
  return key.replace(/[.~*/[\]]/g, '_');
}

function addTo(agg: Record<string, number>, source: unknown) {
  for (const [key, count] of Object.entries((source as Record<string, number>) ?? {})) {
    agg[key] = (agg[key] ?? 0) + Number(count);
  }
}

export async function GET(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();

  const numDays = req.nextUrl.searchParams.get('days') === '7' ? 7 : 30;
  const db = getDb();

  const days = Array.from({ length: numDays }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - i);
    return d.toISOString().slice(0, 10);
  });

  const [snapshots, prodSnap, catSnap] = await Promise.all([
    Promise.all(days.map(day => db.collection('analytics').doc(day).get())),
    db.collection('products').get(),
    db.collection('categories').get(),
  ]);

  let pageViews = 0, mobile = 0, desktop = 0;
  const visitorSet = new Set<string>();
  const pageAgg: Record<string, number> = {};
  const clickMenuAgg: Record<string, number> = {};
  const clickCategoryAgg: Record<string, number> = {};
  const clickProductAgg: Record<string, number> = {};
  const clickAddCartAgg: Record<string, number> = {};
  const daily: { date: string; views: number; visitors: number }[] = [];

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    if (!snap.exists) { daily.push({ date: days[i], views: 0, visitors: 0 }); continue; }
    const data = snap.data()!;
    const dayViews = Number(data.views ?? 0);
    pageViews += dayViews;
    mobile  += Number(data.mobile  ?? 0);
    desktop += Number(data.desktop ?? 0);

    const visArr = Array.isArray(data.visitors) ? (data.visitors as string[]) : [];
    visArr.forEach(id => visitorSet.add(id));

    addTo(pageAgg, data.pages);
    addTo(clickMenuAgg, data.clickMenu);
    addTo(clickCategoryAgg, data.clickCategory);
    addTo(clickProductAgg, data.clickProduct);
    addTo(clickAddCartAgg, data.clickAddCart);

    daily.push({ date: days[i], views: dayViews, visitors: visArr.length });
  }

  const paths = Object.entries(PAGE_KEYS)
    .map(([key, path]) => ({ path, visitors: pageAgg[key] ?? 0 }))
    .filter(p => p.visitors > 0)
    .sort((a, b) => b.visitors - a.visitors);

  const topMenu = Object.entries(PAGE_KEYS)
    .map(([key, path]) => ({ path, count: clickMenuAgg[key] ?? 0 }))
    .filter(m => m.count > 0)
    .sort((a, b) => b.count - a.count);

  const topCategories = catSnap.docs
    .map(d => {
      const c = d.data() as { name: string; emoji?: string };
      return { id: d.id, name: c.name, emoji: c.emoji ?? '🏷️', count: clickCategoryAgg[sanitizeKey(d.id)] ?? 0 };
    })
    .filter(c => c.count > 0)
    .sort((a, b) => b.count - a.count);

  const topProducts = prodSnap.docs
    .map(d => {
      const p = d.data() as { name: string; emoji?: string; bgColor?: string };
      const key = sanitizeKey(d.id);
      return {
        id: d.id, name: p.name, emoji: p.emoji ?? '📦', bgColor: p.bgColor ?? '#F5F0E9',
        clicks: clickProductAgg[key] ?? 0, addToCart: clickAddCartAgg[key] ?? 0,
      };
    })
    .filter(p => p.clicks > 0 || p.addToCart > 0)
    .sort((a, b) => b.clicks - a.clicks);

  return Response.json({
    stats:   { visitors: visitorSet.size, pageViews },
    devices: [{ type: 'mobile', count: mobile }, { type: 'desktop', count: desktop }],
    paths,
    topMenu,
    topCategories,
    topProducts,
    daily: daily.slice(0, 7).reverse(),
  });
}
