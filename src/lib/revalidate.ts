import { after } from 'next/server';
import { revalidateTag } from 'next/cache';
import { SITE_URL } from '@/lib/branding';

// Tells the storefront to drop its products/categories/stats cache right after we write to
// Firestore, so admin edits show up immediately instead of waiting out its cache window
// (5 min for products/categories, 1 hour for stats). Best-effort: if the storefront is
// unreachable or misconfigured, the admin write must still succeed — the storefront
// cache just expires on its own schedule instead.
export async function revalidateStorefront(tag: 'products' | 'categories' | 'stats' | 'payment-info' | 'branding') {
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

// Dipanggil setiap kali stok/HPP produk berubah di luar CRUD produk (pesanan, produksi, konsinyasi,
// koreksi stok, stok gudang). Selain storefront, cache daftar produk admin (`admin-products`, TTL
// 15 detik — dipakai POS & menu Produk) juga harus langsung dibuang; sebelumnya hanya CRUD produk
// yang melakukannya, jadi stok di POS bisa masih angka lama sampai 15 detik setelah penjualan.
// Hanya boleh dipanggil dari Route Handler / Server Function (syarat revalidateTag & after).
export function revalidateProductStock() {
  revalidateTag('admin-products', { expire: 0 });
  after(() => revalidateStorefront('products'));
}
