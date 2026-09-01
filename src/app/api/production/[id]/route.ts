import { NextRequest, after } from 'next/server';
import { randomUUID } from 'crypto';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { writeHistoryEntry } from '@/lib/history';
import { revalidateStorefront } from '@/lib/revalidate';
import { getExpensePg, deleteExpensePg, applyExpensePgAction, type ExpensePgAction } from '@/lib/expenses-pg';
import {
  writeStockLedgerEntryPg, stockLabel, captureAndSetWs, compensateStock,
  type ProductSnapshot, type WsSnapshot,
} from '@/lib/stock-pg';

type Ctx = { params: Promise<{ id: string }> };

interface MaterialUsedInput { materialId: string; materialName: string; unit: string; qty: number }
interface OutputInput { productId: string; productName: string; yieldQty: number }
interface StoredOutput { productId: string; productName: string; yieldQty: number; costPerPcs: number }
interface StoredMaterialUsed { materialId: string; materialName: string; unit: string; qty: number; costPerUnit: number; cost: number }
interface ProductRow { stock_qty: string; cost_price: string | null; open_po: boolean }

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
async function findLaterProductionProductIds(db: FirebaseFirestore.Firestore, createdAt: FirebaseFirestore.Timestamp) {
  const snap = await db.collection('productionBatches').where('createdAt', '>', createdAt).get();
  const ids = new Set<string>();
  snap.docs.forEach(d => {
    ((d.data().outputs as StoredOutput[] | undefined) ?? []).forEach(o => ids.add(o.productId));
  });
  return ids;
}

// Deteksi produk yang stoknya sudah "keluar" (terjual/kasir, pesanan online, transfer, konsinyasi, dsb)
// sejak batch ini dibuat — kalau iya, revert stok/HPP produk (weighted-average) di atas tidak lagi
// akurat karena unit yang mau direvert sudah tidak fungibel lagi dengan sisa stok saat ini (lihat
// komentar di atas). `stock_ledger` (Postgres, Tahap 8-10) adalah ledger append-only yang dipakai
// SEMUA penulis stok sejak migrasi.
async function findConsumedSinceProductIdsPg(sql: ReturnType<typeof getSql>, createdAt: Date) {
  const rows = await sql<{ product_id: string }[]>`
    select distinct product_id from stock_ledger where created_at > ${createdAt} and type = 'out'
  `;
  return new Set(rows.map(r => r.product_id));
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
  const sql = getSql();
  const batchRef = db.collection('productionBatches').doc(id);
  const newExpenseId = randomUUID();
  let pgAction: ExpensePgAction = { type: 'none' };

  const snap = await batchRef.get();
  if (!snap.exists) return Response.json({ error: 'Batch produksi tidak ditemukan.' }, { status: 404 });
  const batch = snap.data()!;
  const oldOutputs = (batch.outputs as StoredOutput[] | undefined) ?? [];
  const oldMaterialsUsed = (batch.materialsUsed as StoredMaterialUsed[] | undefined) ?? [];
  const oldExpenseId = batch.expenseId as string | null | undefined;
  const oldWarehouseId = batch.warehouseId as string | undefined;
  const oldWarehouseName = (batch.warehouseName as string | undefined) ?? '';
  const createdAt = batch.createdAt as FirebaseFirestore.Timestamp;

  const productIds = [...new Set([...oldOutputs.map(o => o.productId), ...newOutputs.map(o => o.productId)])];
  const outputsChanged   = outputSignature(oldOutputs) !== outputSignature(newOutputs);
  const warehouseChanged = (oldWarehouseId ?? '') !== newWarehouseId;

  const [laterTouched, consumedSince] = await Promise.all([
    findLaterProductionProductIds(db, createdAt),
    (outputsChanged || warehouseChanged) ? findConsumedSinceProductIdsPg(sql, createdAt.toDate()) : Promise.resolve(new Set<string>()),
  ]);
  const blockedByLaterProduction = productIds.filter(pid => laterTouched.has(pid));
  if (blockedByLaterProduction.length > 0) {
    const names = [...oldOutputs, ...newOutputs].filter(o => blockedByLaterProduction.includes(o.productId)).map(o => o.productName);
    return Response.json({ error: `Tidak bisa diedit — produk sudah diproduksi lagi setelah batch ini: ${[...new Set(names)].join(', ')}.` }, { status: 400 });
  }
  const blockedByConsumption = productIds.filter(pid => consumedSince.has(pid));
  if (blockedByConsumption.length > 0) {
    const names = [...oldOutputs, ...newOutputs].filter(o => blockedByConsumption.includes(o.productId)).map(o => o.productName);
    return Response.json({ error: `Tidak bisa mengubah jumlah produk atau gudang tujuan — sebagian stok hasil produksi ini sudah terjual/keluar dari gudang: ${[...new Set(names)].join(', ')}. Tanggal, catatan, dan biaya lain tetap bisa diedit tanpa mengubah jumlah/gudang.` }, { status: 400 });
  }

  const materialIds = [...new Set([...oldMaterialsUsed.map(m => m.materialId), ...newMaterialsUsed.map(m => m.materialId)])];
  const materialRefs = materialIds.map(mid => db.collection('rawMaterials').doc(mid));
  const oldExpenseRow = oldExpenseId ? await getExpensePg(oldExpenseId) : null;
  const materialSnaps = await db.getAll(...materialRefs);

  for (const m of newMaterialsUsed) {
    const idx = materialIds.indexOf(m.materialId);
    if (!materialSnaps[idx].exists) return Response.json({ error: `Bahan baku "${m.materialName}" tidak ditemukan.` }, { status: 400 });
  }

  // Bahan baku: kembalikan dulu qty batch lama, lalu cek kecukupan stok memakai qty batch baru
  // (preliminary — pengecekan sungguhan pakai baca segar di transaksi Firestore final di bawah).
  const materialState = new Map<string, number>();
  materialIds.forEach((mid, i) => materialState.set(mid, Number(materialSnaps[i].data()!.stockQty) || 0));
  oldMaterialsUsed.forEach(m => materialState.set(m.materialId, (materialState.get(m.materialId) ?? 0) + m.qty));

  const shortages: string[] = [];
  newMaterialsUsed.forEach(m => {
    const stockQty = materialState.get(m.materialId) ?? 0;
    if (stockQty < m.qty) shortages.push(`${m.materialName} (stok ${Math.round(stockQty * 100) / 100} ${m.unit}, butuh ${m.qty} ${m.unit})`);
  });
  if (shortages.length > 0) return Response.json({ error: `Stok bahan baku tidak cukup: ${shortages.join(', ')}` }, { status: 400 });

  const materialsWithCost: StoredMaterialUsed[] = newMaterialsUsed.map(m => {
    const idx = materialIds.indexOf(m.materialId);
    const costPerUnit = Number(materialSnaps[idx].data()!.avgCost) || 0;
    return { ...m, costPerUnit, cost: costPerUnit * m.qty };
  });
  const materialCost  = materialsWithCost.reduce((s, m) => s + m.cost, 0);
  const totalCost     = materialCost + newOtherCost;
  const totalYieldQty = newOutputs.reduce((s, o) => s + o.yieldQty, 0);
  const costPerPcs    = totalCost / totalYieldQty;

  const productSnapshots: ProductSnapshot[] = [];
  const wsSnapshots: WsSnapshot[] = [];
  const outputsWithCost: StoredOutput[] = [];
  let stockCommitted = false;

  try {
    await sql.begin(async pgTx => {
      const rows = await pgTx<(ProductRow & { id: string })[]>`
        select id, stock_qty, cost_price, open_po from products where id in ${pgTx(productIds)} order by id for update
      `;
      const byId = new Map(rows.map(r => [r.id, r]));
      newOutputs.forEach(o => { if (!byId.has(o.productId)) throw new Error(`Produk "${o.productName}" tidak ditemukan.`); });

      // Produk hasil: kembalikan dulu efek output batch lama (rata-rata tertimbang bersifat asosiatif),
      // lalu terapkan output batch baru dengan HPP/pcs yang baru dihitung.
      const productState = new Map<string, { qty: number; cost: number }>();
      productIds.forEach(pid => {
        const row = byId.get(pid);
        const qty = row ? Number(row.stock_qty) || 0 : 0;
        const cost = row?.cost_price != null ? Number(row.cost_price) : 0;
        productState.set(pid, { qty, cost });
        productSnapshots.push({ productId: pid, oldQty: qty, oldCost: cost, openPO: row?.open_po ?? false });
      });
      oldOutputs.forEach(o => {
        const st = productState.get(o.productId)!;
        productState.set(o.productId, reverseProductState(st.qty, st.cost, o.yieldQty, o.costPerPcs));
      });
      newOutputs.forEach(o => {
        const st = productState.get(o.productId)!;
        const applied = applyProductState(st.qty, st.cost, o.yieldQty, costPerPcs);
        productState.set(o.productId, applied);
        outputsWithCost.push({ ...o, costPerPcs });
      });
      for (const pid of productIds) {
        const st = productState.get(pid)!;
        const openPO = byId.get(pid)?.open_po ?? false;
        await pgTx`update products set stock_qty = ${st.qty}, cost_price = ${st.cost}, stock = ${stockLabel(openPO, st.qty)}, updated_at = now() where id = ${pid}`;
      }

      // Stok gudang: kembalikan efek batch lama di gudang lama, lalu terapkan output batch baru di
      // gudang baru — hanya kalau produk hasil/jumlah atau gudang tujuan benar-benar berubah.
      if (outputsChanged || warehouseChanged) {
        if (oldWarehouseId) {
          for (const o of oldOutputs) {
            await captureAndSetWs(pgTx, wsSnapshots, `${oldWarehouseId}_${o.productId}`, oldWarehouseId, o.productId, o.productName,
              old => Math.max(0, old - o.yieldQty));
            await writeStockLedgerEntryPg(pgTx, {
              productId: o.productId, productName: o.productName, warehouseId: oldWarehouseId, warehouseName: oldWarehouseName,
              type: 'out', qty: o.yieldQty, note: 'Koreksi edit produksi (batch lama)',
            });
          }
        }
        for (const o of newOutputs) {
          await captureAndSetWs(pgTx, wsSnapshots, `${newWarehouseId}_${o.productId}`, newWarehouseId, o.productId, o.productName,
            old => old + o.yieldQty);
          await writeStockLedgerEntryPg(pgTx, {
            productId: o.productId, productName: o.productName, warehouseId: newWarehouseId, warehouseName: newWarehouseName,
            type: 'in', qty: o.yieldQty, note: 'Koreksi edit produksi (batch baru)',
          });
        }
      }
    });
    stockCommitted = true;
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan perubahan.' }, { status: 400 });
  }

  try {
    await db.runTransaction(async tx => {
      const freshMaterialSnaps = await Promise.all(materialRefs.map(r => tx.get(r)));
      materialIds.forEach((mid, i) => {
        if (!freshMaterialSnaps[i].exists) throw new Error('Bahan baku tidak ditemukan.');
      });
      const freshMaterialState = new Map<string, number>();
      materialIds.forEach((mid, i) => freshMaterialState.set(mid, Number(freshMaterialSnaps[i].data()!.stockQty) || 0));
      oldMaterialsUsed.forEach(m => freshMaterialState.set(m.materialId, (freshMaterialState.get(m.materialId) ?? 0) + m.qty));
      const freshShortages: string[] = [];
      newMaterialsUsed.forEach(m => {
        const stockQty = freshMaterialState.get(m.materialId) ?? 0;
        if (stockQty < m.qty) freshShortages.push(`${m.materialName} (stok ${Math.round(stockQty * 100) / 100} ${m.unit}, butuh ${m.qty} ${m.unit})`);
      });
      if (freshShortages.length > 0) throw new Error(`Stok bahan baku tidak cukup: ${freshShortages.join(', ')}`);
      newMaterialsUsed.forEach(m => freshMaterialState.set(m.materialId, (freshMaterialState.get(m.materialId) ?? 0) - m.qty));
      materialIds.forEach((mid, i) => {
        tx.update(materialRefs[i], { stockQty: Math.max(0, freshMaterialState.get(mid) ?? 0), updatedAt: FieldValue.serverTimestamp() });
      });

      // Sinkronkan Pengeluaran otomatis biaya lain dengan nilai terbaru.
      const oldExpenseExists = !!oldExpenseRow;
      let expenseIdToStore: string | null = oldExpenseExists ? (oldExpenseId ?? null) : null;
      const productNames = newOutputs.map(o => o.productName).join(' & ');
      if (newOtherCost > 0) {
        if (oldExpenseExists && oldExpenseId) {
          pgAction = { type: 'update', id: oldExpenseId, description: `Biaya produksi - ${productNames}`, amount: newOtherCost, date };
        } else {
          pgAction = {
            type: 'insert', id: newExpenseId, category: 'Produksi', description: `Biaya produksi - ${productNames}`, amount: newOtherCost, date,
            note: `Otomatis dari biaya lain (tenaga kerja/overhead) produksi ${totalYieldQty} pcs (${productNames})`,
            sourceType: 'production', sourceId: id,
          };
          expenseIdToStore = newExpenseId;
        }
      } else if (oldExpenseExists && oldExpenseId) {
        pgAction = { type: 'delete', id: oldExpenseId };
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
    if (stockCommitted) {
      try { await compensateStock(sql, productSnapshots, wsSnapshots); }
      catch (compErr) { console.error('CRITICAL: gagal kompensasi stok produk setelah edit produksi gagal tersimpan', compErr); }
    }
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan perubahan.' }, { status: 400 });
  }

  if (await applyExpensePgAction(pgAction)) revalidateTag('admin-expenses', { expire: 0 });

  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'production', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const sql = getSql();
  const batchRef = db.collection('productionBatches').doc(id);

  const snap = await batchRef.get();
  if (!snap.exists) return Response.json({ error: 'Batch produksi tidak ditemukan.' }, { status: 404 });
  const batch = snap.data()!;
  const outputs = (batch.outputs as StoredOutput[] | undefined) ?? [];
  const materialsUsed = (batch.materialsUsed as StoredMaterialUsed[] | undefined) ?? [];
  const expenseId = batch.expenseId as string | null | undefined;
  const warehouseId = batch.warehouseId as string | undefined;
  const warehouseName = (batch.warehouseName as string | undefined) ?? '';
  const createdAt = batch.createdAt as FirebaseFirestore.Timestamp;

  const productIds = outputs.map(o => o.productId);
  const [laterTouched, consumedSince] = await Promise.all([
    findLaterProductionProductIds(db, createdAt),
    findConsumedSinceProductIdsPg(sql, createdAt.toDate()),
  ]);
  const blockedByLaterProduction = productIds.filter(pid => laterTouched.has(pid));
  if (blockedByLaterProduction.length > 0) {
    const names = outputs.filter(o => blockedByLaterProduction.includes(o.productId)).map(o => o.productName);
    return Response.json({ error: `Tidak bisa dihapus — produk sudah diproduksi lagi setelah batch ini: ${[...new Set(names)].join(', ')}.` }, { status: 400 });
  }
  const blockedByConsumption = productIds.filter(pid => consumedSince.has(pid));
  if (blockedByConsumption.length > 0) {
    const names = outputs.filter(o => blockedByConsumption.includes(o.productId)).map(o => o.productName);
    return Response.json({ error: `Tidak bisa dihapus — sebagian stok hasil produksi ini sudah terjual/keluar dari gudang: ${[...new Set(names)].join(', ')}.` }, { status: 400 });
  }

  const materialRefs = materialsUsed.map(m => db.collection('rawMaterials').doc(m.materialId));
  const expenseRow = expenseId ? await getExpensePg(expenseId) : null;
  const expenseIdToDelete: string | null = expenseRow ? expenseId! : null;

  const productSnapshots: ProductSnapshot[] = [];
  const wsSnapshots: WsSnapshot[] = [];
  let stockCommitted = false;

  try {
    await sql.begin(async pgTx => {
      const rows = await pgTx<(ProductRow & { id: string })[]>`
        select id, stock_qty, cost_price, open_po from products where id in ${pgTx(productIds)} order by id for update
      `;
      const byId = new Map(rows.map(r => [r.id, r]));

      for (const o of outputs) {
        const row = byId.get(o.productId);
        if (!row) continue;
        const curQty  = Number(row.stock_qty) || 0;
        const curCost = row.cost_price != null ? Number(row.cost_price) : 0;
        productSnapshots.push({ productId: o.productId, oldQty: curQty, oldCost: curCost, openPO: row.open_po });
        const { qty, cost } = reverseProductState(curQty, curCost, o.yieldQty, o.costPerPcs);
        await pgTx`update products set stock_qty = ${qty}, cost_price = ${cost}, stock = ${stockLabel(row.open_po, qty)}, updated_at = now() where id = ${o.productId}`;
      }

      // Kembalikan stok gudang tujuan batch ini (batch lama sebelum fitur ini tidak punya warehouseId).
      if (warehouseId) {
        for (const o of outputs) {
          await captureAndSetWs(pgTx, wsSnapshots, `${warehouseId}_${o.productId}`, warehouseId, o.productId, o.productName,
            old => Math.max(0, old - o.yieldQty));
          await writeStockLedgerEntryPg(pgTx, {
            productId: o.productId, productName: o.productName, warehouseId, warehouseName,
            type: 'out', qty: o.yieldQty, note: 'Hapus batch produksi',
          });
        }
      }
    });
    stockCommitted = true;
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menghapus batch produksi.' }, { status: 400 });
  }

  try {
    await db.runTransaction(async tx => {
      const freshMaterialSnaps = await Promise.all(materialRefs.map(r => tx.get(r)));
      materialsUsed.forEach((m, i) => {
        if (!freshMaterialSnaps[i].exists) return;
        const stockQty = Number(freshMaterialSnaps[i].data()!.stockQty) || 0;
        tx.update(materialRefs[i], { stockQty: stockQty + m.qty, updatedAt: FieldValue.serverTimestamp() });
      });

      tx.delete(batchRef);
      writeHistoryEntry(tx, db, {
        entity: 'production', entityId: id,
        entityLabel: `Produksi ${batch.date ?? id} - ${outputs.map(o => o.productName).join(' & ') || id}`,
        action: 'delete', actor: guard, before: batch,
      });
    });
  } catch (err) {
    if (stockCommitted) {
      try { await compensateStock(sql, productSnapshots, wsSnapshots); }
      catch (compErr) { console.error('CRITICAL: gagal kompensasi stok produk setelah hapus produksi gagal tersimpan', compErr); }
    }
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menghapus batch produksi.' }, { status: 400 });
  }

  if (expenseIdToDelete) {
    await deleteExpensePg(expenseIdToDelete);
    revalidateTag('admin-expenses', { expire: 0 });
  }

  after(() => revalidateStorefront('products'));
  return Response.json({ ok: true });
}
