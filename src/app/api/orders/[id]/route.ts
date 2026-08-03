import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';
import { restoreOrderStock } from '@/lib/order-stock';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id } = await ctx.params;
  const { status, paymentStatus } = await req.json() as { status?: string; paymentStatus?: string };
  const db = getDb();
  const ref = db.collection('orders').doc(id);
  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (status !== undefined) update.status = status;
  if (paymentStatus !== undefined) update.paymentStatus = paymentStatus;

  // Batalkan pesanan → kembalikan stok yang sudah dipotong ke gudang (sekali saja per pesanan)
  if (status === 'dibatalkan') {
    const snap = await ref.get();
    const order = snap.data();
    if (order) {
      await restoreOrderStock({ ...order, invoiceNo: order.invoiceNo });
      update.stockRestored = true;
    }
  }

  await ref.update(update);
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id } = await ctx.params;
  const db = getDb();
  const ref = db.collection('orders').doc(id);

  // Hapus pesanan juga mengembalikan stok (kecuali sudah dikembalikan lewat pembatalan sebelumnya)
  const snap = await ref.get();
  const order = snap.data();
  if (order) await restoreOrderStock(order);

  await ref.delete();
  return Response.json({ ok: true });
}
