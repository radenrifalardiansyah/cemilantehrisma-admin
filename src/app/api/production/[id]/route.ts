import { NextRequest, after } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { writeHistoryEntry } from '@/lib/history';
import { revalidateStorefront } from '@/lib/revalidate';

type Ctx = { params: Promise<{ id: string }> };

interface MaterialUsedInput { materialId: string; materialName: string; unit: string; qty: number }
interface OutputInput { productId: string; productName: string; yieldQty: number }
interface StoredOutput { productId: string; productName: string; yieldQty: number; costPerPcs: number }
interface StoredMaterialUsed { materialId: string; materialName: string; unit: string; qty: number; costPerUnit: number; cost: number }

// Reversal & re-terapan untuk bahan baku aman dilakukan kapan pun — avgCost bahan baku TIDAK
// dipengaruhi produksi (hanya stockQty), jadi tambah-balik lalu kurangi-baru selalu tepat secara
// kuantitas berapa pun urutan transaksi lain di antaranya.
//
// Untuk produk hasil, HPP (costPrice) memakai rata-rata tertimbang yang bersifat asosiatif — batch lain
// yang ikut menambah produk yang sama masih bisa dihitung ulang dengan tepat. Yang TIDAK aman adalah
// kejadian yang MENGURANGI stok produk itu (terjual, dikirim konsinyasi, transfer keluar, dsb) setelah
// batch ini — makanya hanya diblokir kalau ada batch produksi LAIN yang lebih baru menyentuh produk yang
// sama; kalau produk sudah terjual/berpindah stok, edit/hapus tetap dijalankan (best-effort) — cek &
// koreksi manual lewat Edit Produk kalau HPP hasil akhirnya terasa tidak pas.
// `tx`: dibaca lewat transaksi yang sama dengan PUT/DELETE di bawah (bukan `.get()` biasa) supaya
// kalau ada batch produksi baru yang commit TEPAT di celah antara pengecekan ini dan commit
// transaksi ini, Firestore memaksa retry alih-alih membiarkan reversal HPP di bawah berjalan
// berdasarkan data yang sudah basi (TOCTOU).
async function findLaterProductionProductIds(
  db: FirebaseFirestore.Firestore,
  createdAt: FirebaseFirestore.Timestamp,
  tx?: FirebaseFirestore.Transaction,
) {
  const query = db.collection('productionBatches').where('createdAt', '>', createdAt);
  const snap = tx ? await tx.get(query) : await query.get();
  const ids = new Set<string>();
  snap.docs.forEach(d => {
    ((d.data().outputs as StoredOutput[] | undefined) ?? []).forEach(o => ids.add(o.productId));
  });
  return ids;
}

// Deteksi produk yang stoknya sudah "keluar" (terjual/kasir, pesanan online, transfer, konsinyasi, dsb)
// sejak batch ini dibuat — kalau iya, revert stok/HPP produk (weighted-average) di atas tidak lagi
// akurat karena unit yang mau direvert sudah tidak fungibel lagi dengan sisa stok saat ini (lihat
// komentar di atas). `stock` adalah ledger append-only yang dipakai SEMUA penulis stok, query tanpa
// filter tambahan (selain createdAt) biar tidak butuh composite index — sama seperti pola di atas.
async function findConsumedSinceProductIds(
  db: FirebaseFirestore.Firestore,
  createdAt: FirebaseFirestore.Timestamp,
  tx?: FirebaseFirestore.Transaction,
) {
  const query = db.collection('stock').where('createdAt', '>', createdAt).select('type', 'productId');
  const snap = tx ? await tx.get(query) : await query.get();
  const ids = new Set<string>();
  snap.docs.forEach(d => {
    const data = d.data();
    if (data.type === 'out' && typeof data.productId === 'string') ids.add(data.productId);
  });
  return ids;
}

function outputSignature(outputs: { productId: string; yieldQty: number }[]) {
  return outputs.map(o => `${o.productId}:${o.yieldQty}`).sort().join('|');
}

function reverseProductState(curQty: number, curCost: number, yieldQty: number, costPerPcs: number) {
  const newQty = curQty - yieldQty;
  const newCost = newQty > 0 ? (curCost * curQty - yieldQty * costPerPcs) / newQty : 0;
  return { qty: Math.max(0, newQty), cost: Math.max(0, newCost) };
}

function applyProductState(curQty: number, curCost: number, yieldQty: number, costPerPcs: number) {
  const newQty = curQty + yieldQty;
  const newCost = newQty > 0 ? (curCost * curQty + yieldQty * costPerPcs) / newQty : costPerPcs;
  return { qty: newQty, cost: newCost };
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'production', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as {
    date?: string; note?: string; warehouseId?: string; warehouseName?: string;
    outputs: OutputInput[]; materialsUsed: MaterialUsedInput[]; otherCost?: number;
  };
  const newMaterialsUsed = data.materialsUsed ?? [];
  const newOutputs = (data.outputs ?? []).filter(o => (Number(o.yieldQty) || 0) > 0);
  const newOtherCost = Number(data.otherCost) || 0;
  const date = data.date || new Date().toISOString().slice(0, 10);
  const newWarehouseId   = data.warehouseId ?? '';
  const newWarehouseName = data.warehouseName ?? '';
  if (newMaterialsUsed.length === 0) return Response.json({ error: 'Minimal 1 bahan baku dipakai.' }, { status: 400 });
  if (newOutputs.length === 0) return Response.json({ error: 'Minimal 1 produk hasil dengan jumlah lebih dari 0.' }, { status: 400 });
  if (!newWarehouseId) return Response.json({ error: 'Pilih gudang tujuan.' }, { status: 400 });

  const db = getDb();
  const batchRef = db.collection('productionBatches').doc(id);
  const newExpenseRef = db.collection('expenses').doc();

  try {
    await db.runTransaction(async tx => {
      const snap = await tx.get(batchRef);
      if (!snap.exists) throw new Error('Batch produksi tidak ditemukan.');
      const batch = snap.data()!;
      const oldOutputs = (batch.outputs as StoredOutput[] | undefined) ?? [];
      const oldMaterialsUsed = (batch.materialsUsed as StoredMaterialUsed[] | undefined) ?? [];
      const oldExpenseId = batch.expenseId as string | null | undefined;

      const oldWarehouseId = batch.warehouseId as string | undefined;
      const productIds = [...new Set([...oldOutputs.map(o => o.productId), ...newOutputs.map(o => o.productId)])];

      // Perubahan jumlah produk hasil / gudang tujuan mengubah stok — kalau sebagian stok batch ini
      // sudah keluar (terjual dsb) sejak dibuat, revert-nya tidak lagi akurat, jadi diblokir. Perubahan
      // lain (tanggal, catatan, biaya lain, bahan baku) aman kapan pun — revert bahan baku selalu tepat
      // secara kuantitas & tidak menyentuh stok produk, jadi tidak perlu dicek di sini.
      const outputsChanged   = outputSignature(oldOutputs) !== outputSignature(newOutputs);
      const warehouseChanged = (oldWarehouseId ?? '') !== newWarehouseId;
      const [laterTouched, consumedSince] = await Promise.all([
        findLaterProductionProductIds(db, batch.createdAt, tx),
        (outputsChanged || warehouseChanged) ? findConsumedSinceProductIds(db, batch.createdAt, tx) : Promise.resolve(new Set<string>()),
      ]);
      const blockedByLaterProduction = productIds.filter(pid => laterTouched.has(pid));
      if (blockedByLaterProduction.length > 0) {
        const names = [...oldOutputs, ...newOutputs].filter(o => blockedByLaterProduction.includes(o.productId)).map(o => o.productName);
        throw new Error(`Tidak bisa diedit — produk sudah diproduksi lagi setelah batch ini: ${[...new Set(names)].join(', ')}.`);
      }
      const blockedByConsumption = productIds.filter(pid => consumedSince.has(pid));
      if (blockedByConsumption.length > 0) {
        const names = [...oldOutputs, ...newOutputs].filter(o => blockedByConsumption.includes(o.productId)).map(o => o.productName);
        throw new Error(`Tidak bisa mengubah jumlah produk atau gudang tujuan — sebagian stok hasil produksi ini sudah terjual/keluar dari gudang: ${[...new Set(names)].join(', ')}. Tanggal, catatan, dan biaya lain tetap bisa diedit tanpa mengubah jumlah/gudang.`);
      }

      const materialIds = [...new Set([...oldMaterialsUsed.map(m => m.materialId), ...newMaterialsUsed.map(m => m.materialId)])];
      const materialRefs = materialIds.map(mid => db.collection('rawMaterials').doc(mid));
      const productRefs = productIds.map(pid => db.collection('products').doc(pid));
      const oldExpenseSnap = oldExpenseId ? await tx.get(db.collection('expenses').doc(oldExpenseId)) : null;
      const oldWsRefs = oldWarehouseId
        ? oldOutputs.map(o => db.collection('warehouse_stock').doc(`${oldWarehouseId}_${o.productId}`))
        : [];
      const [materialSnaps, productSnaps, oldWsSnaps] = await Promise.all([
        Promise.all(materialRefs.map(r => tx.get(r))),
        Promise.all(productRefs.map(r => tx.get(r))),
        Promise.all(oldWsRefs.map(r => tx.get(r))),
      ]);

      newOutputs.forEach(o => {
        const idx = productIds.indexOf(o.productId);
        if (!productSnaps[idx].exists) throw new Error(`Produk "${o.productName}" tidak ditemukan.`);
      });
      newMaterialsUsed.forEach(m => {
        const idx = materialIds.indexOf(m.materialId);
        if (!materialSnaps[idx].exists) throw new Error(`Bahan baku "${m.materialName}" tidak ditemukan.`);
      });

      // Bahan baku: kembalikan dulu qty batch lama, lalu cek kecukupan stok memakai qty batch baru.
      const materialState = new Map<string, number>();
      materialIds.forEach((mid, i) => materialState.set(mid, Number(materialSnaps[i].data()!.stockQty) || 0));
      oldMaterialsUsed.forEach(m => materialState.set(m.materialId, (materialState.get(m.materialId) ?? 0) + m.qty));

      const shortages: string[] = [];
      newMaterialsUsed.forEach(m => {
        const stockQty = materialState.get(m.materialId) ?? 0;
        if (stockQty < m.qty) shortages.push(`${m.materialName} (stok ${Math.round(stockQty * 100) / 100} ${m.unit}, butuh ${m.qty} ${m.unit})`);
      });
      if (shortages.length > 0) throw new Error(`Stok bahan baku tidak cukup: ${shortages.join(', ')}`);

      const materialsWithCost: StoredMaterialUsed[] = newMaterialsUsed.map(m => {
        const idx = materialIds.indexOf(m.materialId);
        const costPerUnit = Number(materialSnaps[idx].data()!.avgCost) || 0;
        return { ...m, costPerUnit, cost: costPerUnit * m.qty };
      });
      newMaterialsUsed.forEach(m => materialState.set(m.materialId, (materialState.get(m.materialId) ?? 0) - m.qty));
      materialIds.forEach((mid, i) => {
        tx.update(materialRefs[i], { stockQty: Math.max(0, materialState.get(mid) ?? 0), updatedAt: FieldValue.serverTimestamp() });
      });

      const materialCost  = materialsWithCost.reduce((s, m) => s + m.cost, 0);
      const totalCost     = materialCost + newOtherCost;
      const totalYieldQty = newOutputs.reduce((s, o) => s + o.yieldQty, 0);
      const costPerPcs    = totalCost / totalYieldQty;

      // Produk hasil: kembalikan dulu efek output batch lama (rata-rata tertimbang bersifat asosiatif),
      // lalu terapkan output batch baru dengan HPP/pcs yang baru dihitung.
      const productState = new Map<string, { qty: number; cost: number }>();
      productIds.forEach((pid, i) => {
        const p = productSnaps[i].data()!;
        productState.set(pid, { qty: Number(p.stockQty) || 0, cost: Number(p.costPrice) || 0 });
      });
      oldOutputs.forEach(o => {
        const st = productState.get(o.productId)!;
        productState.set(o.productId, reverseProductState(st.qty, st.cost, o.yieldQty, o.costPerPcs));
      });
      const outputsWithCost: StoredOutput[] = newOutputs.map(o => {
        const st = productState.get(o.productId)!;
        const applied = applyProductState(st.qty, st.cost, o.yieldQty, costPerPcs);
        productState.set(o.productId, applied);
        return { ...o, costPerPcs };
      });
      productIds.forEach((pid, i) => {
        const st = productState.get(pid)!;
        const product = productSnaps[i].data()!;
        tx.update(productRefs[i], {
          stockQty: st.qty,
          costPrice: st.cost,
          stock: product.openPO ? 'open_po' : st.qty > 0 ? 'ready' : 'habis',
          updatedAt: FieldValue.serverTimestamp(),
        });
      });

      // Stok gudang: kembalikan efek batch lama di gudang lama, lalu terapkan output batch baru di gudang baru
      // (batch lama sebelum fitur ini tidak punya warehouseId — tidak ada yang perlu dikembalikan).
      // Di-floor ke 0 sama seperti reverseProductState di atas — kalau tidak, stok gudang bisa minus
      // sementara stok produk sudah di-floor duluan, dan dua-duanya jadi tidak sinkron lagi.
      // Hanya dijalankan kalau produk hasil/jumlah atau gudang tujuan benar-benar berubah — edit lain
      // (tanggal, catatan, biaya lain) tidak perlu menambah baris riwayat Stok Masuk/Keluar.
      if (outputsChanged || warehouseChanged) {
        if (oldWarehouseId) {
          oldOutputs.forEach((o, i) => {
            const wsRef = db.collection('warehouse_stock').doc(`${oldWarehouseId}_${o.productId}`);
            const curWsQty = typeof oldWsSnaps[i].data()?.stockQty === 'number' ? oldWsSnaps[i].data()!.stockQty as number : 0;
            tx.set(wsRef, { warehouseId: oldWarehouseId, productId: o.productId, productName: o.productName,
              stockQty: Math.max(0, curWsQty - o.yieldQty), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
            tx.set(db.collection('stock').doc(), {
              warehouseId: oldWarehouseId, warehouseName: batch.warehouseName ?? '',
              productId: o.productId, productName: o.productName,
              type: 'out', qty: o.yieldQty, note: 'Koreksi edit produksi (batch lama)',
              createdAt: FieldValue.serverTimestamp(),
            });
          });
        }
        newOutputs.forEach(o => {
          const wsRef = db.collection('warehouse_stock').doc(`${newWarehouseId}_${o.productId}`);
          tx.set(wsRef, { warehouseId: newWarehouseId, productId: o.productId, productName: o.productName,
            stockQty: FieldValue.increment(o.yieldQty), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          tx.set(db.collection('stock').doc(), {
            warehouseId: newWarehouseId, warehouseName: newWarehouseName,
            productId: o.productId, productName: o.productName,
            type: 'in', qty: o.yieldQty, note: 'Koreksi edit produksi (batch baru)',
            createdAt: FieldValue.serverTimestamp(),
          });
        });
      }

      // Sinkronkan Pengeluaran otomatis biaya lain dengan nilai terbaru.
      const oldExpenseExists = !!oldExpenseSnap?.exists;
      let expenseIdToStore: string | null = oldExpenseExists ? (oldExpenseId ?? null) : null;
      const productNames = newOutputs.map(o => o.productName).join(' & ');
      if (newOtherCost > 0) {
        if (oldExpenseExists && oldExpenseId) {
          tx.update(db.collection('expenses').doc(oldExpenseId), {
            description: `Biaya produksi - ${productNames}`,
            amount: newOtherCost, date, updatedAt: FieldValue.serverTimestamp(),
          });
        } else {
          tx.set(newExpenseRef, {
            category: 'Produksi',
            description: `Biaya produksi - ${productNames}`,
            amount: newOtherCost, date,
            note: `Otomatis dari biaya lain (tenaga kerja/overhead) produksi ${totalYieldQty} pcs (${productNames})`,
            sourceType: 'production',
            sourceId: id,
            createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
          });
          expenseIdToStore = newExpenseRef.id;
        }
      } else if (oldExpenseExists && oldExpenseId) {
        tx.delete(db.collection('expenses').doc(oldExpenseId));
        expenseIdToStore = null;
      }

      const batchUpdate = {
        date, outputs: outputsWithCost, materialsUsed: materialsWithCost,
        materialCost, otherCost: newOtherCost, totalCost, totalYieldQty, costPerPcs,
        warehouseId: newWarehouseId, warehouseName: newWarehouseName,
        note: data.note ?? '',
        expenseId: expenseIdToStore,
        updatedAt: FieldValue.serverTimestamp(),
      };
      tx.update(batchRef, batchUpdate);
      writeHistoryEntry(tx, db, {
        entity: 'production', entityId: id,
        entityLabel: `Produksi ${date} - ${outputsWithCost.map(o => o.productName).join(' & ') || id}`,
        action: 'update', actor: guard, before: batch, after: batchUpdate,
      });
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan perubahan.' }, { status: 400 });
  }

  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'production', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const batchRef = db.collection('productionBatches').doc(id);

  try {
    await db.runTransaction(async tx => {
      const snap = await tx.get(batchRef);
      if (!snap.exists) throw new Error('Batch produksi tidak ditemukan.');
      const batch = snap.data()!;
      const outputs = (batch.outputs as StoredOutput[] | undefined) ?? [];
      const materialsUsed = (batch.materialsUsed as StoredMaterialUsed[] | undefined) ?? [];
      const expenseId = batch.expenseId as string | null | undefined;

      const productIds = outputs.map(o => o.productId);
      const [laterTouched, consumedSince] = await Promise.all([
        findLaterProductionProductIds(db, batch.createdAt, tx),
        findConsumedSinceProductIds(db, batch.createdAt, tx),
      ]);
      const blockedByLaterProduction = productIds.filter(pid => laterTouched.has(pid));
      if (blockedByLaterProduction.length > 0) {
        const names = outputs.filter(o => blockedByLaterProduction.includes(o.productId)).map(o => o.productName);
        throw new Error(`Tidak bisa dihapus — produk sudah diproduksi lagi setelah batch ini: ${[...new Set(names)].join(', ')}.`);
      }
      const blockedByConsumption = productIds.filter(pid => consumedSince.has(pid));
      if (blockedByConsumption.length > 0) {
        const names = outputs.filter(o => blockedByConsumption.includes(o.productId)).map(o => o.productName);
        throw new Error(`Tidak bisa dihapus — sebagian stok hasil produksi ini sudah terjual/keluar dari gudang: ${[...new Set(names)].join(', ')}.`);
      }

      const materialRefs = materialsUsed.map(m => db.collection('rawMaterials').doc(m.materialId));
      const productRefs  = outputs.map(o => db.collection('products').doc(o.productId));
      const expenseSnap = expenseId ? await tx.get(db.collection('expenses').doc(expenseId)) : null;
      const warehouseId = batch.warehouseId as string | undefined;
      const wsRefs = warehouseId
        ? outputs.map(o => db.collection('warehouse_stock').doc(`${warehouseId}_${o.productId}`))
        : [];
      const [materialSnaps, productSnaps, wsSnaps] = await Promise.all([
        Promise.all(materialRefs.map(r => tx.get(r))),
        Promise.all(productRefs.map(r => tx.get(r))),
        Promise.all(wsRefs.map(r => tx.get(r))),
      ]);

      materialsUsed.forEach((m, i) => {
        if (!materialSnaps[i].exists) return;
        const stockQty = Number(materialSnaps[i].data()!.stockQty) || 0;
        tx.update(materialRefs[i], { stockQty: stockQty + m.qty, updatedAt: FieldValue.serverTimestamp() });
      });

      outputs.forEach((o, i) => {
        if (!productSnaps[i].exists) return;
        const product = productSnaps[i].data()!;
        const curQty  = Number(product.stockQty) || 0;
        const curCost = Number(product.costPrice) || 0;
        const { qty, cost } = reverseProductState(curQty, curCost, o.yieldQty, o.costPerPcs);
        tx.update(productRefs[i], {
          stockQty: qty,
          costPrice: cost,
          stock: product.openPO ? 'open_po' : qty > 0 ? 'ready' : 'habis',
          updatedAt: FieldValue.serverTimestamp(),
        });
      });

      // Kembalikan stok gudang tujuan batch ini (batch lama sebelum fitur ini tidak punya warehouseId).
      // Di-floor ke 0 sama seperti reverseProductState di atas, supaya tidak minus & tidak sinkron.
      if (warehouseId) {
        outputs.forEach((o, i) => {
          const wsRef = db.collection('warehouse_stock').doc(`${warehouseId}_${o.productId}`);
          const curWsQty = typeof wsSnaps[i].data()?.stockQty === 'number' ? wsSnaps[i].data()!.stockQty as number : 0;
          tx.set(wsRef, { warehouseId, productId: o.productId, productName: o.productName,
            stockQty: Math.max(0, curWsQty - o.yieldQty), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          tx.set(db.collection('stock').doc(), {
            warehouseId, warehouseName: batch.warehouseName ?? '',
            productId: o.productId, productName: o.productName,
            type: 'out', qty: o.yieldQty, note: 'Hapus batch produksi',
            createdAt: FieldValue.serverTimestamp(),
          });
        });
      }

      if (expenseSnap?.exists) tx.delete(expenseSnap.ref);
      tx.delete(batchRef);
      writeHistoryEntry(tx, db, {
        entity: 'production', entityId: id,
        entityLabel: `Produksi ${batch.date ?? id} - ${outputs.map(o => o.productName).join(' & ') || id}`,
        action: 'delete', actor: guard, before: batch,
      });
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menghapus batch produksi.' }, { status: 400 });
  }

  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}
