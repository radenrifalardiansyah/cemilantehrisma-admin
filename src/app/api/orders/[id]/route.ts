import { NextRequest, after } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { restoreOrderStockInTxPg, RestorableOrder } from '@/lib/order-stock-pg';
import { readProductsForDeltasPg, applyStockDeltaPg, writeStockLedgerEntryPg } from '@/lib/stock-pg';
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
  const sql = getSql();
  const ref = db.collection('orders').doc(id);

  // Edit lengkap — dikirim dengan `items` (bisa tambah/hapus/ubah qty produk, ganti data
  // pelanggan/diskon/pembayaran). Selisih qty per produk disesuaikan ke stok Postgres DULU
  // (Tahap 9-10 Fase 2 — lihat plan gleaming-wondering-quokka.md), baru dokumen order Firestore
  // ditulis — 2 transaksi lintas database, bukan satu; kalau baca `order` di sini sempat basi
  // (diedit lagi oleh orang lain persis di celah antara baca ini dan tulis Firestore di bawah),
  // ini trade-off yang diterima untuk operasi manual/low-frequency seperti ini.
  if (Array.isArray(body.items)) {
    const data = body as OrderEditInput;
    const snap = await ref.get();
    const order = snap.data();
    if (!order) return Response.json({ error: 'Pesanan tidak ditemukan.' }, { status: 404 });
    if (order.status === 'dibatalkan') return Response.json({ error: 'Pesanan yang sudah dibatalkan tidak bisa diedit.' }, { status: 400 });

    // Pertahankan snapshot HPP (costPrice) tiap item lama — lihat komentar panjang versi
    // Firestore sebelumnya (git history) untuk alasan lengkapnya: costPrice produk adalah
    // rata-rata bergerak, jadi baris yang qty/harganya diedit tetap pakai costPrice lama; hanya
    // baris produk yang BENAR-BENAR baru yang costPrice-nya diambil dari HPP produk saat ini.
    const oldCostByProductId = new Map<string, number>();
    (order.items as OrderItemInput[] | undefined ?? []).forEach(it => {
      if (it.productId) oldCostByProductId.set(it.productId, Number(it.costPrice) || 0);
    });
    const newProductIds = [...new Set(
      data.items.map(it => it.productId).filter((pid): pid is string => !!pid && !oldCostByProductId.has(pid)),
    )];
    const freshCostRows = newProductIds.length > 0
      ? await sql<{ id: string; cost_price: string | null }[]>`select id, cost_price from products where id in ${sql(newProductIds)}`
      : [];
    const freshCostByProductId = new Map(freshCostRows.map(r => [r.id, r.cost_price != null ? Number(r.cost_price) : 0]));

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

    let stockCommitted = false;
    if (deltas.size > 0) {
      // qtyByProduct delta di atas positif = lebih banyak dipesan = stok berkurang, jadi
      // dibalik tandanya untuk dipakai sebagai delta stok (negatif = keluar).
      const stockDeltas = new Map([...deltas].map(([pid, d]) => [pid, -d] as [string, number]));
      try {
        await sql.begin(async pgTx => {
          const { products, shortages } = await readProductsForDeltasPg(pgTx, stockDeltas);
          if (shortages.length > 0) throw new Error(`Stok tidak cukup: ${shortages.join(', ')}`);
          for (const [pid, stockDelta] of stockDeltas) {
            const product = products.get(pid)!;
            await applyStockDeltaPg(pgTx, { productId: pid, product, warehouseId: order.warehouseId, delta: stockDelta });
            await writeStockLedgerEntryPg(pgTx, {
              productId: pid, productName: product.name, warehouseId: order.warehouseId, warehouseName: order.warehouseName,
              type: stockDelta < 0 ? 'out' : 'in', qty: stockDelta,
              note: `Edit pesanan ${order.invoiceNo ?? ''}`,
            });
          }
        });
        stockCommitted = true;
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan perubahan.' }, { status: 400 });
      }
    }

    try {
      await db.runTransaction(async tx => {
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
      // Firestore gagal SETELAH stok Postgres sudah disesuaikan — kompensasi: balikkan lagi.
      if (stockCommitted) {
        try {
          await sql.begin(async pgTx => {
            const stockDeltas = new Map([...deltas].map(([pid, d]) => [pid, -d] as [string, number]));
            const reversedDeltas = new Map([...stockDeltas].map(([pid, d]) => [pid, -d] as [string, number]));
            const { products } = await readProductsForDeltasPg(pgTx, reversedDeltas);
            for (const [pid, delta] of reversedDeltas) {
              const product = products.get(pid)!;
              await applyStockDeltaPg(pgTx, { productId: pid, product, warehouseId: order.warehouseId, delta });
              await writeStockLedgerEntryPg(pgTx, {
                productId: pid, productName: product.name, warehouseId: order.warehouseId, warehouseName: order.warehouseName,
                type: delta < 0 ? 'out' : 'in', qty: delta,
                note: `Kompensasi — gagal simpan edit pesanan ${order.invoiceNo ?? ''}`,
              });
            }
          });
        } catch (compErr) {
          console.error('CRITICAL: gagal kompensasi stok setelah edit pesanan gagal tersimpan', compErr);
        }
      }
      return Response.json({ error: err instanceof Error ? err.message : 'Gagal memperbarui pesanan.' }, { status: 400 });
    }
    after(() => revalidateStorefront('products'));
    return Response.json({ ok: true });
  }

  // Update status/paymentStatus saja (batalkan, tandai selesai, tandai lunas)
  const { status, paymentStatus, walletId } = body;
  const snap = await ref.get();
  const order = snap.data() as (RestorableOrder & Record<string, unknown>) | undefined;
  if (!order) return Response.json({ error: 'Pesanan tidak ditemukan.' }, { status: 404 });
  if (status !== undefined && order.status === 'dibatalkan') {
    return Response.json({ error: 'Pesanan yang sudah dibatalkan tidak bisa diubah statusnya lagi.' }, { status: 400 });
  }

  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (status !== undefined) update.status = status;
  if (paymentStatus !== undefined) update.paymentStatus = paymentStatus;
  if (walletId !== undefined) update.walletId = walletId;

  let stockTouched = false;
  let stockCommitted = false;
  let compensate: (() => Promise<void>) | null = null;

  try {
    // Pesanan (online ATAU kasir "Buka PO") ditandai selesai → baru sekarang stoknya dipotong.
    if (status === 'selesai' && !order.stockCut) {
      const settingsSnap = await db.collection('settings').doc('main').get();
      const settings = settingsSnap.data() ?? {};
      const warehouseId = settings.posWarehouseId as string | undefined;
      const warehouseName = settings.posWarehouseName as string | undefined;

      const items = (order.items as OrderItemInput[] | undefined) ?? [];
      const resolved = await Promise.all(items.map(async item => {
        if (item.productId || !item.qty) return item;
        const rows = await sql<{ id: string }[]>`select id from products where name = ${item.name} limit 2`;
        if (rows.length !== 1) return item;
        return { ...item, productId: rows[0].id };
      }));

      const deltas = new Map<string, number>();
      for (const item of resolved) {
        if (!item.productId || !item.qty) continue;
        deltas.set(item.productId, (deltas.get(item.productId) ?? 0) - item.qty);
      }

      if (deltas.size > 0) {
        await sql.begin(async pgTx => {
          const { products, shortages } = await readProductsForDeltasPg(pgTx, deltas);
          if (shortages.length > 0) throw new Error(`Stok tidak cukup: ${shortages.join(', ')}`);
          for (const [productId, delta] of deltas) {
            const product = products.get(productId)!;
            await applyStockDeltaPg(pgTx, { productId, product, warehouseId, delta });
            await writeStockLedgerEntryPg(pgTx, {
              productId, productName: product.name, warehouseId, warehouseName, type: 'out', qty: delta,
              note: `Penjualan Online - ${order.invoiceNo ?? ''}`,
            });
          }
        });
        stockTouched = true;
        stockCommitted = true;
        compensate = async () => {
          const reversedDeltas = new Map([...deltas].map(([pid, d]) => [pid, -d] as [string, number]));
          await sql.begin(async pgTx => {
            const { products } = await readProductsForDeltasPg(pgTx, reversedDeltas);
            for (const [pid, delta] of reversedDeltas) {
              const product = products.get(pid)!;
              await applyStockDeltaPg(pgTx, { productId: pid, product, warehouseId, delta });
              await writeStockLedgerEntryPg(pgTx, {
                productId: pid, productName: product.name, warehouseId, warehouseName, type: 'in', qty: delta,
                note: `Kompensasi — gagal simpan status pesanan ${order.invoiceNo ?? ''}`,
              });
            }
          });
        };
      }

      update.stockCut = true;
      if (warehouseId) { update.warehouseId = warehouseId; update.warehouseName = warehouseName ?? ''; }
    }

    // Batalkan pesanan → kembalikan stok yang sudah dipotong (sekali saja per pesanan)
    if (status === 'dibatalkan') {
      await sql.begin(async pgTx => restoreOrderStockInTxPg(pgTx, order));
      update.stockRestored = true;
      stockTouched = true;
      stockCommitted = true;
      // Restore tidak butuh kompensasi simetris (kompensasinya adalah "potong lagi", yang
      // rutenya sendiri sudah rumit) — kalau Firestore gagal setelah ini, catat saja untuk
      // rekonsiliasi manual, konsisten dengan trade-off yang sudah didokumentasikan.
      compensate = async () => {
        console.error(`Perlu rekonsiliasi manual: stok pesanan ${order.invoiceNo ?? id} sudah di-restore di Postgres tapi status batal gagal tersimpan.`);
      };
    }
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal memperbarui pesanan.' }, { status: 400 });
  }

  try {
    await db.runTransaction(async tx => {
      const freshSnap = await tx.get(ref);
      const freshOrder = freshSnap.data();
      if (!freshOrder) throw new Error('Pesanan tidak ditemukan.');
      tx.update(ref, update);
      writeHistoryEntry(tx, db, {
        entity: 'orders', entityId: id, entityLabel: `Pesanan ${freshOrder.invoiceNo ?? id}`,
        action: 'update', actor: guard, before: freshOrder, after: update,
      });
    });
  } catch (err) {
    if (stockCommitted && compensate) {
      try { await compensate(); } catch (compErr) { console.error('CRITICAL: gagal kompensasi stok setelah update status gagal tersimpan', compErr); }
    }
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
  const sql = getSql();
  const ref = db.collection('orders').doc(id);

  const snap = await ref.get();
  const order = snap.data() as RestorableOrder | undefined;

  let stockCommitted = false;
  if (order) {
    try {
      await sql.begin(async pgTx => restoreOrderStockInTxPg(pgTx, order));
      stockCommitted = true;
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : 'Gagal menghapus pesanan.' }, { status: 400 });
    }
  }

  try {
    await db.runTransaction(async tx => {
      const freshSnap = await tx.get(ref);
      const freshOrder = freshSnap.data();
      tx.delete(ref);
      if (freshOrder) {
        writeHistoryEntry(tx, db, {
          entity: 'orders', entityId: id, entityLabel: `Pesanan ${freshOrder.invoiceNo ?? id}`,
          action: 'delete', actor: guard, before: freshOrder,
        });
      }
    });
  } catch (err) {
    if (stockCommitted) {
      console.error(`Perlu rekonsiliasi manual: stok pesanan ${id} sudah di-restore di Postgres tapi dokumen pesanan gagal dihapus.`, err);
    }
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menghapus pesanan.' }, { status: 400 });
  }

  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}
