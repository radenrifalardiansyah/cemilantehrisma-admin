import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { writeHistoryEntry } from '@/lib/history';

type Ctx = { params: Promise<{ id: string }> };

interface PurchaseItem { materialId: string; materialName: string; unit: string; qty: number; price: number }

const itemsKey = (items: PurchaseItem[]) =>
  JSON.stringify(items.map(it => ({ materialId: it.materialId, qty: it.qty, price: it.price })));

// Edit — kalau daftar bahan baku/qty/harga berubah, HANYA diizinkan kalau tidak ada pembelian/produksi
// lain yang menyentuh salah satu bahan baku (lama maupun baru) SETELAH transaksi ini dibuat, supaya
// stok & harga rata-rata (avgCost) bisa dihitung ulang dengan tepat. Kalau cuma ganti supplier/tanggal/
// catatan/status bayar tanpa mengubah barang, selalu boleh (tidak menyentuh stok).
export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as {
    supplierId?: string; supplierName: string; date?: string; note?: string;
    items: PurchaseItem[]; paymentStatus?: 'lunas' | 'belum_lunas';
  };
  const newItems = data.items ?? [];
  if (newItems.length === 0) return Response.json({ error: 'Minimal 1 bahan baku.' }, { status: 400 });
  const newPaymentStatus = data.paymentStatus === 'belum_lunas' ? 'belum_lunas' : 'lunas';
  const date = data.date || new Date().toISOString().slice(0, 10);

  const db = getDb();
  const purchaseRef  = db.collection('materialPurchases').doc(id);
  const newExpenseRef = db.collection('expenses').doc();

  try {
    await db.runTransaction(async tx => {
      const snap = await tx.get(purchaseRef);
      if (!snap.exists) throw new Error('Pembelian tidak ditemukan.');
      const purchase = snap.data()!;
      const oldItems = (purchase.items as PurchaseItem[] | undefined) ?? [];
      const itemsChanged = itemsKey(oldItems) !== itemsKey(newItems);

      // Baca dulu expense lama (kalau ada) sebelum tulis apa pun — supaya tahu apakah masih ada
      // (bisa saja sudah dihapus manual dari menu Pengeluaran) sebelum memutuskan update vs buat baru.
      const oldExpenseId = purchase.expenseId as string | null | undefined;
      const oldExpenseSnap = oldExpenseId ? await tx.get(db.collection('expenses').doc(oldExpenseId)) : null;

      let itemsWithSubtotal = oldItems.map(it => ({ ...it, subtotal: it.qty * it.price }));
      let total = Number(purchase.total) || 0;

      if (itemsChanged) {
        const createdAt = purchase.createdAt;
        const materialIds = [...new Set([...oldItems.map(it => it.materialId), ...newItems.map(it => it.materialId)])];

        const [laterPurchasesSnap, laterBatchesSnap] = await Promise.all([
          db.collection('materialPurchases').where('createdAt', '>', createdAt).get(),
          db.collection('productionBatches').where('createdAt', '>', createdAt).get(),
        ]);
        const touchedAfter = new Set<string>();
        laterPurchasesSnap.docs.forEach(d => {
          ((d.data().items as PurchaseItem[] | undefined) ?? []).forEach(it => touchedAfter.add(it.materialId));
        });
        laterBatchesSnap.docs.forEach(d => {
          ((d.data().materialsUsed as { materialId: string }[] | undefined) ?? []).forEach(m => touchedAfter.add(m.materialId));
        });
        const blocked = materialIds.filter(mid => touchedAfter.has(mid));
        if (blocked.length > 0) {
          const names = [...oldItems, ...newItems].filter(it => blocked.includes(it.materialId)).map(it => it.materialName);
          throw new Error(`Tidak bisa diedit — bahan baku sudah dibeli/dipakai lagi setelah transaksi ini: ${[...new Set(names)].join(', ')}.`);
        }

        const materialRefs = materialIds.map(mid => db.collection('rawMaterials').doc(mid));
        const materialSnaps = await Promise.all(materialRefs.map(r => tx.get(r)));

        newItems.forEach(it => {
          const idx = materialIds.indexOf(it.materialId);
          if (!materialSnaps[idx].exists) throw new Error(`Bahan baku "${it.materialName}" tidak ditemukan.`);
        });

        const finalState = new Map<string, { qty: number; avg: number }>();
        materialIds.forEach((mid, i) => {
          const m = materialSnaps[i].data();
          finalState.set(mid, { qty: Number(m?.stockQty) || 0, avg: Number(m?.avgCost) || 0 });
        });

        // Kembalikan dulu efek barang lama, baru terapkan barang baru — persis reversal+forward
        // yang dipakai di DELETE & POST, supaya avgCost tetap konsisten.
        oldItems.forEach(it => {
          const st = finalState.get(it.materialId)!;
          const qty = st.qty - it.qty;
          const avg = qty > 0 ? (st.avg * st.qty - it.qty * it.price) / qty : 0;
          finalState.set(it.materialId, { qty, avg });
        });
        newItems.forEach(it => {
          const st = finalState.get(it.materialId)!;
          const qty = st.qty + it.qty;
          const avg = qty > 0 ? (st.avg * st.qty + it.qty * it.price) / qty : 0;
          finalState.set(it.materialId, { qty, avg });
        });

        materialIds.forEach((mid, i) => {
          const st = finalState.get(mid)!;
          tx.update(materialRefs[i], { stockQty: Math.max(0, st.qty), avgCost: Math.max(0, st.avg), updatedAt: FieldValue.serverTimestamp() });
        });

        itemsWithSubtotal = newItems.map(it => ({ ...it, subtotal: it.qty * it.price }));
        total = itemsWithSubtotal.reduce((s, it) => s + it.subtotal, 0);
      }

      // Sinkronkan Pengeluaran otomatis dengan status pembayaran & total terbaru. Expense lama
      // dianggap "ada" hanya kalau benar-benar masih ada di database (bisa saja sudah dihapus
      // manual dari menu Pengeluaran) — kalau sudah tidak ada, dibuatkan baru, bukan tx.update
      // yang akan gagal karena dokumennya tidak ada.
      const oldExpenseExists = !!oldExpenseSnap?.exists;
      let expenseIdToStore: string | null = oldExpenseExists ? (oldExpenseId ?? null) : null;
      const supplierName = data.supplierName ?? purchase.supplierName ?? '';

      if (newPaymentStatus === 'lunas') {
        if (oldExpenseExists && oldExpenseId) {
          tx.update(db.collection('expenses').doc(oldExpenseId), {
            description: `Pembelian bahan baku - ${supplierName || 'Tanpa nama'}`,
            amount: total, date, updatedAt: FieldValue.serverTimestamp(),
          });
        } else {
          tx.set(newExpenseRef, {
            category: 'Bahan Baku',
            description: `Pembelian bahan baku - ${supplierName || 'Tanpa nama'}`,
            amount: total, date,
            note: `Otomatis dari pembelian bahan baku (${itemsWithSubtotal.map(it => it.materialName).join(', ')})`,
            sourceType: 'material-purchase',
            sourceId: id,
            createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
          });
          expenseIdToStore = newExpenseRef.id;
        }
      } else if (oldExpenseExists && oldExpenseId) {
        tx.delete(db.collection('expenses').doc(oldExpenseId));
        expenseIdToStore = null;
      }

      const purchaseUpdate = {
        supplierId: data.supplierId ?? null,
        supplierName,
        items: itemsWithSubtotal,
        total,
        date,
        paymentStatus: newPaymentStatus,
        expenseId: expenseIdToStore,
        note: data.note ?? '',
        updatedAt: FieldValue.serverTimestamp(),
      };
      tx.update(purchaseRef, purchaseUpdate);

      writeHistoryEntry(tx, db, {
        entity: 'material-purchases',
        entityId: id,
        entityLabel: `${supplierName?.trim() || purchase.supplierName || 'Tanpa nama'} - Rp${total}`,
        action: 'update',
        actor: guard,
        before: purchase,
        after: { ...purchase, ...purchaseUpdate },
      });
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan perubahan.' }, { status: 400 });
  }

  return Response.json({ ok: true });
}

// Hapus — HANYA diizinkan kalau tidak ada pembelian/produksi lain yang menyentuh salah satu bahan
// baku di transaksi ini SETELAH transaksi ini dibuat. Kalau aman, stok & harga rata-rata (avgCost)
// tiap bahan baku dikembalikan persis seperti sebelum pembelian ini, dan Pengeluaran otomatisnya
// (kalau ada) ikut dihapus.
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const purchaseRef = db.collection('materialPurchases').doc(id);

  try {
    await db.runTransaction(async tx => {
      const snap = await tx.get(purchaseRef);
      if (!snap.exists) throw new Error('Pembelian tidak ditemukan.');
      const purchase = snap.data()!;
      const items = (purchase.items as PurchaseItem[] | undefined) ?? [];
      const createdAt = purchase.createdAt;

      const [laterPurchasesSnap, laterBatchesSnap] = await Promise.all([
        db.collection('materialPurchases').where('createdAt', '>', createdAt).get(),
        db.collection('productionBatches').where('createdAt', '>', createdAt).get(),
      ]);
      const touchedAfter = new Set<string>();
      laterPurchasesSnap.docs.forEach(d => {
        ((d.data().items as PurchaseItem[] | undefined) ?? []).forEach(it => touchedAfter.add(it.materialId));
      });
      laterBatchesSnap.docs.forEach(d => {
        ((d.data().materialsUsed as { materialId: string }[] | undefined) ?? []).forEach(m => touchedAfter.add(m.materialId));
      });
      const blockedNames = items.filter(it => touchedAfter.has(it.materialId)).map(it => it.materialName);
      if (blockedNames.length > 0) {
        throw new Error(`Tidak bisa dihapus — bahan baku sudah dibeli/dipakai lagi setelah transaksi ini: ${blockedNames.join(', ')}.`);
      }

      const materialRefs = items.map(it => db.collection('rawMaterials').doc(it.materialId));
      const materialSnaps = await Promise.all(materialRefs.map(r => tx.get(r)));
      const expenseId = purchase.expenseId as string | null | undefined;
      const expenseSnap = expenseId ? await tx.get(db.collection('expenses').doc(expenseId)) : null;

      items.forEach((it, i) => {
        if (!materialSnaps[i].exists) return;
        const m = materialSnaps[i].data()!;
        const curQty = Number(m.stockQty) || 0;
        const curAvg = Number(m.avgCost) || 0;
        const oldQty = curQty - it.qty;
        // Kebalikan dari rumus rata-rata tertimbang saat pembelian: curAvg = (oldQty*oldAvg + qty*price) / curQty
        const oldAvg = oldQty > 0 ? (curAvg * curQty - it.qty * it.price) / oldQty : 0;
        tx.update(materialRefs[i], {
          stockQty: Math.max(0, oldQty),
          avgCost: Math.max(0, oldAvg),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });

      if (expenseSnap?.exists) tx.delete(expenseSnap.ref);
      tx.delete(purchaseRef);

      if (purchase) {
        writeHistoryEntry(tx, db, {
          entity: 'material-purchases',
          entityId: id,
          entityLabel: `${purchase.supplierName?.toString().trim() || 'Tanpa nama'} - Rp${Number(purchase.total) || 0}`,
          action: 'delete',
          actor: guard,
          before: purchase,
        });
      }
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menghapus pembelian.' }, { status: 400 });
  }

  return Response.json({ ok: true });
}
