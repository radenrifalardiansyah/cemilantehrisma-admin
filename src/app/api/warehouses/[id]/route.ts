import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { logHistory } from '@/lib/history';
import { clearWarehouseStockForProducts } from '@/lib/warehouse-stock';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'settings', 'view');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const doc = await getDb().collection('warehouses').doc(id).get();
  if (!doc.exists) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ warehouse: { id: doc.id, ...doc.data() } });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'settings', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();

  const beforeSnap = await db.collection('warehouses').doc(id).get();
  const before = beforeSnap.exists ? beforeSnap.data() ?? null : null;

  const after = {
    name: data.name,
    location: data.location ?? '',
    description: data.description ?? '',
    updatedAt: FieldValue.serverTimestamp(),
  };
  await db.collection('warehouses').doc(id).update(after);

  try {
    await logHistory(db, {
      entity: 'warehouses',
      entityId: id,
      entityLabel: (data.name as string) ?? (before?.name as string) ?? id,
      action: 'update',
      actor: guard,
      before,
      after,
    });
  } catch {
    // audit log failure must never fail the business request
  }

  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'settings', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();

  const beforeSnap = await db.collection('warehouses').doc(id).get();
  const before = beforeSnap.exists ? beforeSnap.data() ?? null : null;

  // Kembalikan dulu stok tiap produk di gudang ini ke `products.stockQty` global SEBELUM baris
  // warehouse_stock-nya dihapus — kalau dihapus langsung lewat batch.delete tanpa lewat sini,
  // stockQty global tetap menghitung stok yang sudah tidak ada di gudang manapun (stok hantu).
  const stockSnap = await db.collection('warehouse_stock').where('warehouseId', '==', id).get();
  const productIds = stockSnap.docs
    .filter(d => ((d.data().stockQty as number) ?? 0) > 0)
    .map(d => d.data().productId as string);
  const { cleared, failed } = await clearWarehouseStockForProducts(id, productIds, 'Gudang dihapus');
  // Kalau ada produk yang gagal dikembalikan stoknya, JANGAN lanjut menghapus gudang & baris
  // warehouse_stock-nya — produk yang sudah berhasil (`cleared`) tetap permanen ter-commit, tapi
  // menghapus gudang di titik ini akan mengorbankan sisanya jadi stok hantu lagi (masalah yang
  // justru sedang diperbaiki). Aman diulang: yang sudah cleared di-skip otomatis (no-op) di
  // percobaan hapus berikutnya.
  if (failed.length > 0) {
    return Response.json({
      error: `Gagal mengembalikan stok ${failed.length} produk sebelum menghapus gudang — coba hapus lagi. (${cleared.length} produk lain sudah berhasil dikembalikan.)`,
      failed,
    }, { status: 500 });
  }

  await db.collection('warehouses').doc(id).delete();

  try {
    await logHistory(db, {
      entity: 'warehouses',
      entityId: id,
      entityLabel: (before?.name as string) ?? id,
      action: 'delete',
      actor: guard,
      before,
      meta: { clearedProductCount: cleared.length },
    });
  } catch {
    // audit log failure must never fail the business request
  }

  // Hapus sisa dokumen warehouse_stock untuk gudang ini (sekarang sudah bernilai 0 lewat
  // clearWarehouseProductStock di atas, atau memang sudah 0 sebelumnya).
  if (!stockSnap.empty) {
    const batch = db.batch();
    stockSnap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  return Response.json({ ok: true });
}
