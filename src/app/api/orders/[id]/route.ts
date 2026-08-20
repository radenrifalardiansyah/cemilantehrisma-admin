import { NextRequest, after } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { restoreOrderStockInTx, RestorableOrder } from '@/lib/order-stock';
import { readProductsForDeltas, applyStockDelta, writeStockLedgerEntry } from '@/lib/stock';
import { writeHistoryEntry } from '@/lib/history';
import { revalidateStorefront } from '@/lib/revalidate';

type Ctx = { params: Promise<{ id: string }> };

interface OrderItemInput { productId?: string; name: string; weight: string; qty: number; price: number; subtotal: number; }
interface OrderEditInput {
  customerName: string; customerPhone?: string; items: OrderItemInput[];
  subtotal: number; discount?: { amount: number; label: string }; total: number;
  paymentMethod?: 'cash' | 'transfer' | 'qris' | 'kredit';
  amountPaid?: number; changeAmount?: number;
  transferBank?: string; transferAmount?: number; transferProofUrl?: string;
  paymentStatus?: 'lunas' | 'belum_lunas'; note?: string;
  date?: string; transactionAt?: string; walletId?: string | null;
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
  const guard = await requirePermission(req, 'orders', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const body = await req.json() as { status?: string; paymentStatus?: string; walletId?: string | null; items?: OrderItemInput[] } & Partial<OrderEditInput>;
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

        // Selisih qty hanya disesuaikan ke stok kalau pesanan ini memang sudah pernah memotong
        // stok (kasir sejak dibuat, atau pesanan online yang sudah "Selesai") — sama seperti
        // aturan restore, supaya edit pesanan yang belum memotong stok tidak ikut memotongnya.
        const stockCut = order.source === 'kasir' || order.stockCut === true;
        const deltas = new Map<string, number>();
        if (stockCut) {
          const oldQty = qtyByProduct(order.items ?? []);
          const newQty = qtyByProduct(data.items);
          const productIds = new Set([...oldQty.keys(), ...newQty.keys()]);
          for (const pid of productIds) {
            const delta = (newQty.get(pid) ?? 0) - (oldQty.get(pid) ?? 0);
            if (delta !== 0) deltas.set(pid, delta);
          }
        }

        if (deltas.size > 0) {
          // qtyByProduct delta di atas positif = lebih banyak dipesan = stok berkurang, jadi
          // dibalik tandanya untuk dipakai sebagai delta stok (negatif = keluar).
          const stockDeltas = new Map([...deltas].map(([pid, d]) => [pid, -d]));
          const { products, shortages } = await readProductsForDeltas(tx, db, stockDeltas);
          if (shortages.length > 0) throw new Error(`Stok tidak cukup: ${shortages.join(', ')}`);

          for (const [pid, stockDelta] of stockDeltas) {
            const product = products.get(pid)!;
            applyStockDelta(tx, db, { productId: pid, product, warehouseId: order.warehouseId, delta: stockDelta });
            writeStockLedgerEntry(tx, db, {
              productId: pid, warehouseId: order.warehouseId, warehouseName: order.warehouseName,
              type: stockDelta < 0 ? 'out' : 'in', qty: stockDelta,
              note: `Edit pesanan ${order.invoiceNo ?? ''}`,
            });
          }
        }

        const items = data.items.map(it => ({ ...it, subtotal: it.price * it.qty }));
        const orderUpdate: Record<string, unknown> = {
          customerName: data.customerName, customerPhone: data.customerPhone, items,
          subtotal: data.subtotal, discount: data.discount, total: data.total,
          paymentMethod: data.paymentMethod, amountPaid: data.amountPaid, changeAmount: data.changeAmount,
          transferBank: data.transferBank, transferAmount: data.transferAmount, transferProofUrl: data.transferProofUrl,
          paymentStatus: data.paymentStatus, note: data.note, walletId: data.walletId,
          // Kasir bisa mengedit tanggal & jam transaksi (mis. salah input awal) — dipakai buat urutan
          // & filter periode di Pesanan/Laporan Keuangan, sama seperti saat pesanan dibuat.
          date: data.date,
          createdAt: data.transactionAt ? Timestamp.fromDate(new Date(data.transactionAt)) : undefined,
          updatedAt: FieldValue.serverTimestamp(),
        };
        Object.keys(orderUpdate).forEach(k => { if (orderUpdate[k] === undefined) delete orderUpdate[k]; });
        tx.update(ref, orderUpdate);
        writeHistoryEntry(tx, db, {
          entity: 'orders', entityId: id, entityLabel: `Pesanan ${order.invoiceNo ?? id}`,
          action: 'update', actor: guard, before: order, after: orderUpdate,
        });
      });
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : 'Gagal memperbarui pesanan.' }, { status: 400 });
    }
    after(() => revalidateStorefront('products'));
    return Response.json({ ok: true });
  }

  // Update status/paymentStatus saja (batalkan, tandai selesai, tandai lunas)
  const { status, paymentStatus, walletId } = body;
  let stockTouched = false;
  try {
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const order = snap.data() as (RestorableOrder & Record<string, unknown>) | undefined;
      if (!order) throw new Error('Pesanan tidak ditemukan.');

      const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
      if (status !== undefined) update.status = status;
      if (paymentStatus !== undefined) update.paymentStatus = paymentStatus;
      if (walletId !== undefined) update.walletId = walletId;

      // Pesanan online ditandai selesai → baru sekarang stoknya dipotong (pesanan 'baru' yang
      // belum dikonfirmasi tidak pernah mengunci stok). Dipotong dari gudang yang sama dengan
      // kasir (Pengaturan > Gudang Kasir). Kalau stok kurang, batalkan — status tetap 'baru'.
      if (status === 'selesai' && order.source === 'portal' && !order.stockCut) {
        const settingsSnap = await tx.get(db.collection('settings').doc('main'));
        const settings = settingsSnap.data() ?? {};
        const warehouseId = settings.posWarehouseId as string | undefined;
        const warehouseName = settings.posWarehouseName as string | undefined;

        const items = order.items ?? [];
        const resolved = await Promise.all(items.map(async item => {
          if (item.productId || !item.qty) return item;
          const s = await tx.get(db.collection('products').where('name', '==', item.name).limit(1));
          if (s.empty) return item;
          return { ...item, productId: s.docs[0].id };
        }));

        const deltas = new Map<string, number>();
        for (const item of resolved) {
          if (!item.productId || !item.qty) continue;
          deltas.set(item.productId, (deltas.get(item.productId) ?? 0) - item.qty);
        }

        if (deltas.size > 0) {
          const { products, shortages } = await readProductsForDeltas(tx, db, deltas);
          if (shortages.length > 0) throw new Error(`Stok tidak cukup: ${shortages.join(', ')}`);

          for (const [productId, delta] of deltas) {
            const product = products.get(productId)!;
            applyStockDelta(tx, db, { productId, product, warehouseId, delta });
            writeStockLedgerEntry(tx, db, {
              productId, warehouseId, warehouseName, type: 'out', qty: delta,
              note: `Penjualan Online - ${order.invoiceNo ?? ''}`,
            });
          }
          stockTouched = true;
        }

        update.stockCut = true;
        if (warehouseId) { update.warehouseId = warehouseId; update.warehouseName = warehouseName ?? ''; }
      }

      // Batalkan pesanan → kembalikan stok yang sudah dipotong ke gudang (sekali saja per pesanan)
      if (status === 'dibatalkan') {
        await restoreOrderStockInTx(tx, db, order);
        update.stockRestored = true;
        stockTouched = true;
      }

      tx.update(ref, update);
      writeHistoryEntry(tx, db, {
        entity: 'orders', entityId: id, entityLabel: `Pesanan ${order.invoiceNo ?? id}`,
        action: 'update', actor: guard, before: order, after: update,
      });
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal memperbarui pesanan.' }, { status: 400 });
  }

  if (stockTouched) after(() => revalidateStorefront('products'));
  // "Terjual" di beranda storefront dihitung dari qty pesanan berstatus 'selesai' — status
  // apapun yang berubah di sini bisa menggeser hitungan itu (jadi/lepas dari 'selesai').
  if (status !== undefined) after(() => revalidateStorefront('stats'));
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'orders', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const ref = db.collection('orders').doc(id);

  // Hapus pesanan juga mengembalikan stok (kecuali sudah dikembalikan lewat pembatalan
  // sebelumnya) — restore dan hapus digabung dalam satu transaksi supaya tidak ada state
  // parsial kalau salah satu gagal.
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const order = snap.data() as RestorableOrder | undefined;
    if (order) await restoreOrderStockInTx(tx, db, order);
    tx.delete(ref);
    if (order) {
      writeHistoryEntry(tx, db, {
        entity: 'orders', entityId: id, entityLabel: `Pesanan ${order.invoiceNo ?? id}`,
        action: 'delete', actor: guard, before: order,
      });
    }
  });

  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}
