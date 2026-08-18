import { SITE_URL } from '@/lib/site';

// Tells the storefront to drop its products/categories/stats cache right after we write to
// Firestore, so admin edits show up immediately instead of waiting out its cache window
// (5 min for products/categories, 1 hour for stats). Best-effort: if the storefront is
// unreachable or misconfigured, the admin write must still succeed — the storefront
// cache just expires on its own schedule instead.
export async function revalidateStorefront(tag: 'products' | 'categories' | 'stats') {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return;
  try {
    await fetch(`${SITE_URL}/api/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ tag }),
    });
  } catch {
    // ignore — best-effort
  }
}
