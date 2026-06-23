import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

const PRODUCTS = [
  { id: 'mk-ori-150', name: 'Mie Kremes Original', description: 'Mie kremes renyah dengan bumbu original gurih. Perpaduan mie kering & rempah alami yang bikin nagih.', details: ['Bahan: Mie Kering, Minyak Nabati, Kencur, Bawang Putih, Daun Jeruk', 'Bersertifikat HALAL Indonesia', 'NIB: 0403260068412 — Produksi Bogor', 'Tanpa pengawet, tekstur super crispy', 'Cocok untuk camilan sore & menemani santai'], price: 10000, emoji: '🍝', category: 'mie', badge: 'Best Seller', stock: 'open_po', gradient: 'from-orange-700 via-amber-600 to-yellow-400', bgColor: '#C2410C', weight: '150g', imageUrls: [], stockQty: 0 },
  { id: 'mk-pdas-150', name: 'Mie Kremes Pedas', description: 'Mie kremes dengan bubuk cabai asli dan bumbu pedas khas. Pedas yang nendang, renyah yang maknyuss!', details: ['Bahan: Mie Kering, Bubuk Cabai Asli, Bumbu Pedas, Daun Jeruk, Kencur, Bawang Putih', 'Bersertifikat HALAL Indonesia', 'NIB: 0403260068412 — Produksi Bogor', 'Tanpa pengawet, tekstur super crispy', 'Untuk pecinta pedas sejati!'], price: 10000, emoji: '🍝', category: 'mie', badge: 'Popular', stock: 'open_po', gradient: 'from-red-700 via-rose-600 to-orange-400', bgColor: '#BE123C', weight: '150g', imageUrls: [], stockQty: 0 },
  { id: 'kk-ori-100', name: 'Keripik Kimpul Original', description: 'Keripik kimpul / talas balitung super renyah dengan rasa original gurih alami. Bahan pilihan dari petani lokal Bogor.', details: ['Bahan: Talas Kimpul Pilihan, Minyak Goreng, Garam', 'Bersertifikat HALAL Indonesia', 'NIB: 0403260068412 — Produksi Bogor', 'Tanpa pengawet, tahan hingga 3 bulan', 'Cocok untuk oleh-oleh & stok ngemil'], price: 15000, emoji: '🥔', category: 'keripik', badge: 'Best Seller', stock: 'habis', gradient: 'from-amber-700 via-yellow-600 to-amber-400', bgColor: '#B45309', weight: '100g', imageUrls: [], stockQty: 0 },
  { id: 'kk-bbq-100', name: 'Keripik Kimpul BBQ Pedas', description: 'Perpaduan sempurna rasa BBQ smoky dengan sensasi pedas yang nagih. Renyah di setiap gigitan!', details: ['Bahan: Talas Kimpul Pilihan, Minyak Goreng, Garam, Bubuk Perasa BBQ', 'Bersertifikat HALAL Indonesia', 'NIB: 0403260068412 — Produksi Bogor', 'Tanpa pengawet, tahan hingga 3 bulan', 'Cocok untuk menemani kumpul bareng'], price: 15000, emoji: '🌶️', category: 'keripik', badge: 'Popular', stock: 'habis', gradient: 'from-red-700 via-orange-600 to-red-400', bgColor: '#B91C1C', weight: '100g', imageUrls: [], stockQty: 0 },
  { id: 'kk-jgn-100', name: 'Keripik Kimpul Rasa Jagung', description: 'Keripik kimpul dengan cita rasa jagung manis yang lezat. Sempurna untuk cemilan santai kapan saja.', details: ['Bahan: Talas Kimpul Pilihan, Minyak Goreng, Garam, Bubuk Jagung Manis', 'Bersertifikat HALAL Indonesia', 'NIB: 0403260068412 — Produksi Bogor', 'Tanpa pengawet, tahan hingga 3 bulan', 'Favorit anak-anak & cocok untuk bekal'], price: 15000, emoji: '🌽', category: 'keripik', badge: 'New', stock: 'habis', gradient: 'from-yellow-700 via-yellow-500 to-amber-300', bgColor: '#CA8A04', weight: '100g', imageUrls: [], stockQty: 0 },
  { id: 'kk-ori-250', name: 'Keripik Kimpul Original Jumbo', description: 'Keripik kimpul original ukuran jumbo 250g. Lebih banyak, lebih hemat, cocok untuk stok di rumah.', details: ['Bahan: Talas Kimpul Pilihan, Minyak Goreng, Garam', 'Bersertifikat HALAL Indonesia', 'NIB: 0403260068412 — Produksi Bogor', 'Ukuran jumbo 250g, lebih hemat dari 100g', 'Tahan hingga 3 bulan setelah produksi'], price: 26500, emoji: '🥔', category: 'keripik', stock: 'habis', gradient: 'from-amber-800 via-amber-600 to-yellow-500', bgColor: '#92400E', weight: '250g', imageUrls: [], stockQty: 0 },
  { id: 'kk-bbq-250', name: 'Keripik Kimpul BBQ Pedas Jumbo', description: 'BBQ Pedas ukuran jumbo 250g. Porsi lebih besar untuk berbagi saat kumpul keluarga dan teman.', details: ['Bahan: Talas Kimpul Pilihan, Minyak Goreng, Garam, Bubuk Perasa BBQ', 'Bersertifikat HALAL Indonesia', 'NIB: 0403260068412 — Produksi Bogor', 'Ukuran jumbo 250g, hemat lebih banyak', 'Tahan hingga 3 bulan setelah produksi'], price: 26500, emoji: '🌶️', category: 'keripik', badge: 'Popular', stock: 'habis', gradient: 'from-red-800 via-red-600 to-orange-500', bgColor: '#991B1B', weight: '250g', imageUrls: [], stockQty: 0 },
  { id: 'kk-jgn-250', name: 'Keripik Kimpul Jagung Jumbo', description: 'Rasa Jagung Manis ukuran jumbo 250g. Pilihan tepat untuk ngemil sekeluarga sambil santai.', details: ['Bahan: Talas Kimpul Pilihan, Minyak Goreng, Garam, Bubuk Jagung Manis', 'Bersertifikat HALAL Indonesia', 'NIB: 0403260068412 — Produksi Bogor', 'Ukuran jumbo 250g, hemat lebih banyak', 'Tahan hingga 3 bulan setelah produksi'], price: 26500, emoji: '🌽', category: 'keripik', stock: 'habis', gradient: 'from-yellow-800 via-yellow-600 to-amber-400', bgColor: '#A16207', weight: '250g', imageUrls: [], stockQty: 0 },
  { id: 'pk-mix3', name: 'Paket Mix 3 Rasa Keripik', description: 'Hemat! 3 pcs Keripik Kimpul 100g mix 3 rasa: Original, BBQ Pedas, dan Jagung Manis.', details: ['Isi: 3 pcs Keripik Kimpul 100g', 'Rasa: Original + BBQ Pedas + Jagung', 'Bebas pilih kombinasi rasa', 'Hemat Rp 5.000 dari harga normal', 'Cocok untuk hadiah & oleh-oleh'], price: 40000, originalPrice: 45000, emoji: '🎁', category: 'paket', badge: 'Best Seller', stock: 'habis', gradient: 'from-violet-700 via-purple-600 to-fuchsia-400', bgColor: '#6D28D9', weight: '3 × 100g', imageUrls: [], stockQty: 0 },
  { id: 'pk-mix5', name: 'Paket Mix 5 Pcs Keripik', description: 'Super hemat! 5 pcs Keripik Kimpul 100g, bebas pilih rasa. Cocok untuk oleh-oleh atau kado.', details: ['Isi: 5 pcs Keripik Kimpul 100g', 'Bebas pilih kombinasi 3 rasa', 'Hemat Rp 10.000 dari harga normal', 'Dilengkapi kemasan eksklusif', 'Pilihan terbaik untuk kado & oleh-oleh'], price: 65000, originalPrice: 75000, emoji: '🛍️', category: 'paket', badge: 'Popular', stock: 'habis', gradient: 'from-rose-700 via-pink-600 to-rose-400', bgColor: '#9F1239', weight: '5 × 100g', imageUrls: [], stockQty: 0 },
  { id: 'pk-campur', name: 'Paket Campur Keripik + Mie', description: 'Paket kombo terbaik! 2 Keripik Kimpul + 2 Mie Kremes. Cobain dua produk unggulan sekaligus.', details: ['Isi: 2 Keripik Kimpul 100g + 2 Mie Kremes', 'Bebas pilih rasa masing-masing produk', 'Hemat dibanding beli satuan', 'Cocok untuk yang mau coba semua produk', 'Dikemas rapi, siap kirim'], price: 44000, originalPrice: 50000, emoji: '📦', category: 'paket', badge: 'New', stock: 'habis', gradient: 'from-teal-700 via-cyan-600 to-emerald-400', bgColor: '#0F766E', weight: '4 pcs', imageUrls: [], stockQty: 0 },
];

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const db = getDb();
  const batch = db.batch();
  let count = 0;

  for (const p of PRODUCTS) {
    const { id, ...data } = p;
    const ref = db.collection('products').doc(id);
    const existing = await ref.get();
    if (!existing.exists) {
      batch.set(ref, { ...data, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      count++;
    }
  }

  await batch.commit();
  return Response.json({ seeded: count, total: PRODUCTS.length });
}
