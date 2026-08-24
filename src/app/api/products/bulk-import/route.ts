import { NextRequest, after } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { productUrl } from '@/lib/branding';
import { revalidateStorefront } from '@/lib/revalidate';

interface ImportRow {
  code?: string; name: string; category: string;
  price: number; originalPrice?: number; weight?: string;
  stockQty?: number; openPO?: boolean; badge?: string; description?: string;
}

const BATCH_LIMIT = 400;

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'products', 'create');
  if (guard instanceof Response) return guard;
  const { products } = await req.json() as { products: ImportRow[] };
  if (!Array.isArray(products) || products.length === 0) {
    return Response.json({ error: 'Tidak ada data produk untuk diimpor.' }, { status: 400 });
  }

  const db = getDb();
  const [existingSnap, settingsSnap] = await Promise.all([
    db.collection('products').get(),
    db.collection('settings').doc('main').get(),
  ]);
  const existingCodes = new Set(
    existingSnap.docs.map(d => ((d.data().code as string) ?? '').trim()).filter(Boolean),
  );
  const seenCodes = new Set<string>();

  // Baris dengan stockQty > 0 butuh gudang kasir (Pengaturan) untuk menulis entri warehouse_stock
  // yang sepadan — tanpa gudang, produk akan "tersedia" secara global (products.stockQty) tanpa
  // baris warehouse_stock manapun, melanggar invarian jumlah stok per gudang harus selalu sama
  // dengan total global (lihat lib/stock.ts). Kalau belum dikonfigurasi, produk tetap diimpor
  // tapi stoknya di-nolkan (bukan diam-diam "tersedia" tanpa jejak di gudang manapun) — jumlah
  // yang di-nolkan dikembalikan di respons supaya UI bisa memperingatkan penggunanya.
  const settings = settingsSnap.data() ?? {};
  const warehouseId = settings.posWarehouseId as string | undefined;
  const warehouseName = (settings.posWarehouseName as string | undefined) ?? '';

  let created = 0, skippedInvalid = 0, skippedDuplicate = 0, stockDroppedNoWarehouse = 0;
  let batch = db.batch();
  let opsInBatch = 0;
  let pendingCreated = 0;
  let pendingStockEntries: { id: string; name: string; stockQty: number }[] = [];
  // Produk yang diimpor dengan stockQty > 0 juga perlu entri warehouse_stock awal (gudang kasir
  // dari Pengaturan), supaya langsung muncul di tab Stok Per Gudang, bukan cuma di daftar Produk.
  // Cuma diisi dari chunk yang SUDAH commit (lihat flush()) — kalau chunk terakhir gagal, entri
  // stok untuk baris yang belum ter-commit tidak boleh ikut ditulis.
  const createdWithStock: { id: string; name: string; stockQty: number }[] = [];

  // Commit tiap chunk dibungkus try/catch — tanpa ini, satu commit gagal di tengah jalan membuat
  // seluruh request 500 tanpa laporan created/skipped sama sekali, padahal chunk-chunk sebelumnya
  // sudah permanen tersimpan.
  async function flush(): Promise<boolean> {
    if (opsInBatch === 0) return true;
    try {
      await batch.commit();
      created += pendingCreated;
      createdWithStock.push(...pendingStockEntries);
      batch = db.batch();
      opsInBatch = 0;
      pendingCreated = 0;
      pendingStockEntries = [];
      return true;
    } catch (err) {
      console.error('Bulk import produk: commit chunk gagal', err);
      return false;
    }
  }

  for (const row of products) {
    const name     = (row.name ?? '').toString().trim();
    const category = (row.category ?? '').toString().trim();
    const code     = (row.code ?? '').toString().trim();
    const price    = Number(row.price) || 0;
    if (!name || !category || price <= 0) { skippedInvalid++; continue; }
    if (code && (existingCodes.has(code) || seenCodes.has(code))) { skippedDuplicate++; continue; }

    if (code) seenCodes.add(code);
    const requestedStockQty = Number(row.stockQty) || 0;
    if (requestedStockQty > 0 && !warehouseId) stockDroppedNoWarehouse++;
    const stockQty = warehouseId ? requestedStockQty : 0;
    const openPO   = !!row.openPO;
    const ref = db.collection('products').doc();
    batch.set(ref, {
      name, code, category,
      price, originalPrice: row.originalPrice || null,
      weight: (row.weight ?? '').toString().trim(),
      description: (row.description ?? '').toString().trim(),
      details: [''], badge: (row.badge ?? '').toString().trim(),
      emoji: '🛍️', imageUrls: [],
      gradient: 'from-amber-700 to-yellow-500', bgColor: '#B45309',
      stockQty, openPO, published: true,
      stock: openPO ? 'open_po' : stockQty > 0 ? 'ready' : 'habis',
      qrUrl: productUrl(ref.id),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    pendingCreated++;
    opsInBatch++;
    if (stockQty > 0) pendingStockEntries.push({ id: ref.id, name, stockQty });

    if (opsInBatch >= BATCH_LIMIT && !(await flush())) {
      if (created > 0) after(() => revalidateStorefront('products'));
      return Response.json({
        created, skippedInvalid, skippedDuplicate, stockDroppedNoWarehouse,
        error: `Impor terhenti — ${created} produk berhasil disimpan sebelum gagal. Data yang sudah tersimpan aman; coba impor ulang sisanya.`,
      }, { status: 500 });
    }
  }
  if (!(await flush())) {
    if (created > 0) after(() => revalidateStorefront('products'));
    return Response.json({
      created, skippedInvalid, skippedDuplicate, stockDroppedNoWarehouse,
      error: `Impor terhenti — ${created} produk berhasil disimpan sebelum gagal. Data yang sudah tersimpan aman; coba impor ulang sisanya.`,
    }, { status: 500 });
  }

  if (createdWithStock.length > 0 && warehouseId) {
    await Promise.all(createdWithStock.map(p => Promise.all([
      db.collection('warehouse_stock').doc(`${warehouseId}_${p.id}`).set({
        warehouseId, productId: p.id, productName: p.name,
        stockQty: FieldValue.increment(p.stockQty), updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
      db.collection('stock').add({
        productId: p.id, warehouseId, warehouseName,
        type: 'in', qty: p.stockQty, note: 'Impor produk',
        createdAt: FieldValue.serverTimestamp(),
      }),
    ])));
  }

  if (created > 0) after(() => revalidateStorefront('products'));
  return Response.json({ created, skippedInvalid, skippedDuplicate, stockDroppedNoWarehouse });
}
