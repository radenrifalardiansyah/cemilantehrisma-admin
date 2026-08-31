import { NextRequest, after } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { restoreOrderStockInTx, RestorableOrder } from '@/lib/order-stock';
import { readProductsForDeltas, applyStockDelta, writeStockLedgerEntry } from '@/lib/stock';
import { writeHistoryEntry } from '@/lib/history';
import { revalidateStorefront } from '@/lib/revalidate';

type Ctx = { params: Promise<{ id: string }> };

interface OrderItemInput { productId?: string; name: string; weight: string; qty: number; price: number; subtotal: number; costPrice?: number }
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

        // Pertahankan snapshot HPP (costPrice) tiap item lama — costPrice produk adalah rata-rata
        // bergerak yang terus berubah seiring produksi baru, jadi kalau array items ditimpa tanpa
        // costPrice, HPP historis pesanan ini diam-diam dihitung ulang pakai HPP produk SAAT INI
        // ketika laporan dibuka nanti (lihat fallback di analytics/overview.ts), menggeser laba
        // periode yang sudah ditutup — bahkan untuk edit yang tidak menyentuh item sama sekali
        // (mis. cuma ganti nama pelanggan). Baris yang qty/harganya diedit tetap pakai costPrice
        // lama; hanya baris produk yang BENAR-BENAR baru (belum ada di pesanan ini sebelumnya)
        // yang costPrice-nya diambil dari harga pokok produk saat ini — tidak ada histori lain.
        const oldCostByProductId = new Map<string, number>();
        (order.items as OrderItemInput[] | undefined ?? []).forEach(it => {
          if (it.productId) oldCostByProductId.set(it.productId, Number(it.costPrice) || 0);
        });
        const newProductIds = [...new Set(
          data.items.map(it => it.productId).filter((pid): pid is string => !!pid && !oldCostByProductId.has(pid)),
        )];
        const newProductSnaps = await Promise.all(
          newProductIds.map(pid => tx.get(db.collection('products').doc(pid))),
        );
        const freshCostByProductId = new Map(
          newProductIds.map((pid, i) => [pid, Number(newProductSnaps[i].data()?.costPrice) || 0]),
        );

        // Selisih qty hanya disesuaikan ke stok kalau pesanan ini memang sudah pernah memotong
        // stok (kasir sejak dibuat, atau pesanan online/kasir-PO yang sudah "Selesai") — sama
        // seperti aturan restore, supaya edit pesanan yang belum memotong stok tidak ikut
        // memotongnya. `stockCut === false` eksplisit (pesanan kasir berisi item "Buka PO", atau
        // pesanan online yang belum dikonfirmasi) mengalahkan asumsi lama "kasir pasti sudah
        // memotong stok" — asumsi itu cuma dipakai lagi untuk dokumen lama dari sebelum field
        // `stockCut` ada sama sekali (undefined, bukan false).
        const stockCut = order.stockCut === true || (order.source === 'kasir' && order.stockCut === undefined);
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

        const items = data.items.map(it => ({
          ...it,
          subtotal: it.price * it.qty,
          costPrice: it.productId ? (oldCostByProductId.get(it.productId) ?? freshCostByProductId.get(it.productId) ?? 0) : 0,
        }));
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

      // "dibatalkan" adalah status akhir — sama seperti cabang edit item di atas yang menolak
      // mengedit pesanan berstatus batal. Tanpa guard ini, siklus baru→selesai (stok terpotong,
      // stockCut=true)→dibatalkan (stok dikembalikan, tapi stockCut TIDAK pernah direset)→selesai
      // lagi lolos guard recut stok (karena stockCut masih true dari siklus pertama) sehingga
      // stok tidak terpotong ulang, padahal pendapatan pesanan ini terhitung lagi di analitik.
      if (status !== undefined && order.status === 'dibatalkan') {
        throw new Error('Pesanan yang sudah dibatalkan tidak bisa diubah statusnya lagi.');
      }

      const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
      if (status !== undefined) update.status = status;
      if (paymentStatus !== undefined) update.paymentStatus = paymentStatus;
      if (walletId !== undefined) update.walletId = walletId;

      // Pesanan (online ATAU kasir yang berisi item "Buka PO") ditandai selesai → baru sekarang
      // stoknya dipotong ('baru' yang belum dikonfirmasi tidak pernah mengunci stok). Dipotong
      // dari gudang yang sama dengan kasir (Pengaturan > Gudang Kasir). Kalau stok kurang,
      // batalkan — status tetap 'baru'.
      if (status === 'selesai' && !order.stockCut) {
        const settingsSnap = await tx.get(db.collection('settings').doc('main'));
        const settings = settingsSnap.data() ?? {};
        const warehouseId = settings.posWarehouseId as string | undefined;
        const warehouseName = settings.posWarehouseName as string | undefined;

        const items = order.items ?? [];
        // limit(2) (bukan 1) supaya bisa dideteksi kalau ada LEBIH DARI SATU produk dengan nama
        // yang sama persis — kalau ambigu, lebih aman membiarkan item ini tidak terpotong
        // stoknya (perilaku lama untuk item yang sama sekali tidak ketemu) daripada menebak salah
        // satu dan memotong stok produk yang keliru.
        const resolved = await Promise.all(items.map(async item => {
          if (item.productId || !item.qty) return item;
          const s = await tx.get(db.collection('products').where('name', '==', item.name).limit(2));
          if (s.size !== 1) return item;
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
