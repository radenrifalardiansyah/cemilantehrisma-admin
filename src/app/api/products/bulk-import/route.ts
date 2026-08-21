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
  const existingSnap = await db.collection('products').get();
  const existingCodes = new Set(
    existingSnap.docs.map(d => ((d.data().code as string) ?? '').trim()).filter(Boolean),
  );
  const seenCodes = new Set<string>();

  let created = 0, skippedInvalid = 0, skippedDuplicate = 0;
  let batch = db.batch();
  let opsInBatch = 0;
  // Produk yang diimpor dengan stockQty > 0 juga perlu entri warehouse_stock awal (gudang kasir
  // dari Pengaturan), supaya langsung muncul di tab Stok Per Gudang, bukan cuma di daftar Produk.
  const createdWithStock: { id: string; name: string; stockQty: number }[] = [];

  for (const row of products) {
    const name     = (row.name ?? '').toString().trim();
    const category = (row.category ?? '').toString().trim();
    const code     = (row.code ?? '').toString().trim();
    const price    = Number(row.price) || 0;
    if (!name || !category || price <= 0) { skippedInvalid++; continue; }
    if (code && (existingCodes.has(code) || seenCodes.has(code))) { skippedDuplicate++; continue; }

    if (code) seenCodes.add(code);
    const stockQty = Number(row.stockQty) || 0;
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
    created++;
    opsInBatch++;
    if (stockQty > 0) createdWithStock.push({ id: ref.id, name, stockQty });

    if (opsInBatch >= BATCH_LIMIT) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  }
  if (opsInBatch > 0) await batch.commit();

  if (createdWithStock.length > 0) {
    const settingsSnap = await db.collection('settings').doc('main').get();
    const settings = settingsSnap.data() ?? {};
    const warehouseId = settings.posWarehouseId as string | undefined;
    const warehouseName = (settings.posWarehouseName as string | undefined) ?? '';
    if (warehouseId) {
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
  }

  if (created > 0) after(() => revalidateStorefront('products'));
  return Response.json({ created, skippedInvalid, skippedDuplicate });
}
