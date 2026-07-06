import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

type Ctx = { params: Promise<{ productId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { productId } = await ctx.params;
  const snap = await getDb()
    .collection('stock')
    .where('productId', '==', productId)
    .orderBy('date', 'desc')
    .get();
  const entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ entries });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { productId } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const ref = await db.collection('stock').add({
    productId,
    ...data,
    createdAt: FieldValue.serverTimestamp(),
  });

  // Update running stock on product document, and derive its ready/habis status from the new total
  // (unless "Buka PO" is manually enabled on the product, which always wins)
  const qty = typeof data.qty === 'number' ? data.qty : 0;
  const type = data.type as 'in' | 'out';
  const delta = type === 'in' ? qty : -qty;
  const productRef = db.collection('products').doc(productId);
  await db.runTransaction(async tx => {
    const snap = await tx.get(productRef);
    const product = snap.data();
    const currentQty = typeof product?.stockQty === 'number' ? product.stockQty as number : 0;
    const newQty = currentQty + delta;
    tx.update(productRef, {
      stockQty: newQty,
      stock: product?.openPO ? 'open_po' : newQty > 0 ? 'ready' : 'habis',
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return Response.json({ id: ref.id });
}
