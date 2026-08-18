import { NextRequest, after } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getAuthUser } from '@/lib/admin-auth';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidateStorefront } from '@/lib/revalidate';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'products', 'view');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const doc = await getDb().collection('products').doc(id).get();
  if (!doc.exists) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ id: doc.id, ...doc.data() });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'products', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  // Stok tidak boleh diubah lewat endpoint ini (harus lewat /api/stock/* atau
  // /api/warehouses/*/stock, yang menjaga products.stockQty & warehouse_stock tetap sinkron).
  delete data.stockQty;
  delete data.stock;

  const db = getDb();
  const ref = db.collection('products').doc(id);

  // Catat riwayat perubahan harga jual (audit trail) di koleksi `price_history` supaya kalau
  // ada transaksi dengan harga yang beda dari harga sekarang, bisa ditelusuri siapa & kapan
  // harga produk ini pernah diubah — tanpa perlu mengubah alur update produk yang lain.
  if (typeof data.price === 'number') {
    const before = await ref.get();
    const oldPrice = before.data()?.price;
    if (typeof oldPrice === 'number' && oldPrice !== data.price) {
      await db.collection('price_history').add({
        productId: id,
        productName: before.data()?.name ?? '',
        oldPrice,
        newPrice: data.price,
        changedBy: getAuthUser(req)?.username ?? '',
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  }

  await ref.update({
    ...data,
    updatedAt: FieldValue.serverTimestamp(),
  });
  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'products', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  await getDb().collection('products').doc(id).delete();
  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}
