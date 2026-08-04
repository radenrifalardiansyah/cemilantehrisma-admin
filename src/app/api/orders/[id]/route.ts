import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { restoreOrderStock } from '@/lib/order-stock';

type Ctx = { params: Promise<{ id: string }> };

interface OrderItemInput { productId?: string; name: string; weight: string; qty: number; price: number; subtotal: number; }
interface OrderEditInput {
  customerName: string; customerPhone?: string; items: OrderItemInput[];
  subtotal: number; discount?: { amount: number; label: string }; total: number;
  paymentMethod?: 'cash' | 'transfer' | 'qris' | 'kredit';
  amountPaid?: number; changeAmount?: number;
  transferBank?: string; transferAmount?: number; transferProofUrl?: string;
  paymentStatus?: 'lunas' | 'belum_lunas'; note?: string;
  date?: string; transactionAt?: string;
}

function qtyByProduct(items: OrderItemInput[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const it of items) {
    if (!it.productId || !it.qty) continue;
    map.set(it.productId, (map.get(it.productId) ?? 0) + it.qty);
  }
  return map;
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id } = await ctx.params;
  const body = await req.json() as { status?: string; paymentStatus?: string; items?: OrderItemInput[] } & Partial<OrderEditInput>;
  const db = getDb();
  const ref = db.collection('orders').doc(id);

  // Edit lengkap — dikirim dengan `items` (bisa tambah/hapus/ubah qty produk, ganti data
  // pelanggan/diskon/pembayaran). Selisih qty per produk disesuaikan ke stok gudang dalam
  // satu transaksi yang sama, mengikuti pola edit di rekap konsinyasi (validasi dulu, baru terapkan).
  if (Array.isArray(body.items)) {
    const data = body as OrderEditInput;
    try {
      await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const order = snap.data();
        if (!order) throw new Error('Pesanan tidak ditemukan.');
        if (order.status === 'dibatalkan') throw new Error('Pesanan yang sudah dibatalkan tidak bisa diedit.');

        const deltas = new Map<string, number>();
        if (order.source === 'kasir') {
          const oldQty = qtyByProduct(order.items ?? []);
          const newQty = qtyByProduct(data.items);
          const productIds = new Set([...oldQty.keys(), ...newQty.keys()]);
          for (const pid of productIds) {
            const delta = (newQty.get(pid) ?? 0) - (oldQty.get(pid) ?? 0);
            if (delta !== 0) deltas.set(pid, delta);
          }
        }

        const productIds = [...deltas.keys()];
        const productRefs = productIds.map(pid => db.collection('products').doc(pid));
        const productSnaps = await Promise.all(productRefs.map(r => tx.get(r)));

        const shortages: string[] = [];
        productIds.forEach((pid, i) => {
          const delta = deltas.get(pid)!;
          if (delta <= 0) return;
          const product = productSnaps[i].data();
          const stockQty = typeof product?.stockQty === 'number' ? product.stockQty as number : 0;
          if (!productSnaps[i].exists || stockQty < delta) {
            shortages.push(`${product?.name ?? pid} (stok tersisa ${stockQty}, butuh tambahan ${delta})`);
          }
        });
        if (shortages.length > 0) throw new Error(`Stok tidak cukup: ${shortages.join(', ')}`);

        productIds.forEach((pid, i) => {
          const delta = deltas.get(pid)!;
          const product = productSnaps[i].data()!;
          const currentQty = typeof product.stockQty === 'number' ? product.stockQty as number : 0;
          const newStockQty = currentQty - delta;
          tx.update(productRefs[i], {
            stockQty: newStockQty,
            stock: product.openPO ? 'open_po' : newStockQty > 0 ? 'ready' : 'habis',
            updatedAt: FieldValue.serverTimestamp(),
          });

          // Pesanan lama (sebelum gudang kasir dikonfigurasi) tidak punya warehouseId — stok gudang
          // tidak pernah dikurangi untuk pesanan itu, jadi tidak ikut disesuaikan di sini juga.
          if (order.warehouseId) {
            const wsRef = db.collection('warehouse_stock').doc(`${order.warehouseId}_${pid}`);
            tx.set(wsRef, {
              warehouseId: order.warehouseId, productId: pid, productName: product.name ?? '',
              stockQty: FieldValue.increment(-delta), updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
          }

          const stockRef = db.collection('stock').doc();
          tx.set(stockRef, {
            productId: pid,
            ...(order.warehouseId ? { warehouseId: order.warehouseId, warehouseName: order.warehouseName ?? '' } : {}),
            type: delta > 0 ? 'out' : 'in',
            qty: Math.abs(delta),
            note: `Edit pesanan ${order.invoiceNo ?? ''}`,
            createdAt: FieldValue.serverTimestamp(),
          });
        });

        const items = data.items.map(it => ({ ...it, subtotal: it.price * it.qty }));
        const orderUpdate: Record<string, unknown> = {
          customerName: data.customerName, customerPhone: data.customerPhone, items,
          subtotal: data.subtotal, discount: data.discount, total: data.total,
          paymentMethod: data.paymentMethod, amountPaid: data.amountPaid, changeAmount: data.changeAmount,
          transferBank: data.transferBank, transferAmount: data.transferAmount, transferProofUrl: data.transferProofUrl,
          paymentStatus: data.paymentStatus, note: data.note,
          // Kasir bisa mengedit tanggal & jam transaksi (mis. salah input awal) — dipakai buat urutan
          // & filter periode di Pesanan/Laporan Keuangan, sama seperti saat pesanan dibuat.
          date: data.date,
          createdAt: data.transactionAt ? Timestamp.fromDate(new Date(data.transactionAt)) : undefined,
          updatedAt: FieldValue.serverTimestamp(),
        };
        Object.keys(orderUpdate).forEach(k => { if (orderUpdate[k] === undefined) delete orderUpdate[k]; });
        tx.update(ref, orderUpdate);
      });
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : 'Gagal memperbarui pesanan.' }, { status: 400 });
    }
    return Response.json({ ok: true });
  }

  // Update status/paymentStatus saja (batalkan, tandai selesai, tandai lunas)
  const { status, paymentStatus } = body;
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
