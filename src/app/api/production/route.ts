import { NextRequest, after } from 'next/server';
import { randomUUID } from 'crypto';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { writeHistoryEntry } from '@/lib/history';
import { writeNotification, sendPush } from '@/lib/notifications';
import { isMaterialLowStock } from '@/lib/stock-helpers';
import { revalidateStorefront } from '@/lib/revalidate';
import { insertExpensePg } from '@/lib/expenses-pg';
import { writeStockLedgerEntryPg } from '@/lib/stock-pg';

interface MaterialUsedInput { materialId: string; materialName: string; unit: string; qty: number }
interface OutputInput { productId: string; productName: string; yieldQty: number }
interface BatchWithMeta { id: string; warehouseId?: string; outputs?: { productId: string; yieldQty: number }[]; createdAt?: Timestamp }

// Gabungkan baris dengan id yang sama SEBELUM dipakai untuk tx.get/tx.update — tanpa ini, dua
// baris bahan (atau dua baris hasil) untuk material/produk yang sama masing-masing menghitung
// delta dari snapshot awal yang sama lalu tx.update dengan nilai literal, sehingga baris kedua
// menimpa (bukan menambah) hasil baris pertama dan stok jadi kurang terpotong/kurang bertambah.
function mergeMaterialsUsed(rows: MaterialUsedInput[]): MaterialUsedInput[] {
  const merged = new Map<string, MaterialUsedInput>();
  for (const r of rows) {
    const qty = Number(r.qty) || 0;
    const existing = merged.get(r.materialId);
    if (existing) existing.qty += qty;
    else merged.set(r.materialId, { ...r, qty });
  }
  return [...merged.values()];
}

function mergeOutputs(rows: OutputInput[]): OutputInput[] {
  const merged = new Map<string, OutputInput>();
  for (const r of rows) {
    const qty = Number(r.yieldQty) || 0;
    const existing = merged.get(r.productId);
    if (existing) existing.yieldQty += qty;
    else merged.set(r.productId, { ...r, yieldQty: qty });
  }
  return [...merged.values()];
}

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'production', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get('limit') ?? '50');
  const db = getDb();
  const sql = getSql();
  const snap = await db.collection('productionBatches').orderBy('createdAt', 'desc').limit(limit).get();
  const batches = snap.docs.map(d => ({ id: d.id, ...d.data() })) as BatchWithMeta[];

  // "Closed" = stok hasil produksi batch ini di gudang tujuannya dianggap sudah habis. Tidak ada lot
  // tracking per-batch di penulisan stok, jadi dihitung ulang di sini dengan asumsi FIFO: stok yang
  // TERSISA saat ini dianggap berasal dari batch yang PALING BARU dulu (barang lama terjual duluan) —
  // alokasikan stok gudang saat ini ke batch dari yang terbaru ke yang terlama sampai habis; batch yang
  // tidak lagi kebagian jatah dianggap closed. Ini best-effort (asumsi FIFO), bukan pencatatan per-lot
  // yang sesungguhnya, tapi cukup akurat untuk kebutuhan tampilan status di riwayat produksi.
  const wsKeys = new Set<string>();
  batches.forEach(b => {
    if (!b.warehouseId) return;
    (b.outputs ?? []).forEach(o => wsKeys.add(`${b.warehouseId}_${o.productId}`));
  });
  const wsKeyList = [...wsKeys];
  const wsRows = wsKeyList.length > 0
    ? await sql<{ id: string; stock_qty: string }[]>`select id, stock_qty from warehouse_stock where id in ${sql(wsKeyList)}`
    : [];
  const wsById = new Map(wsRows.map(r => [r.id, Number(r.stock_qty) || 0]));
  const wsStock = new Map<string, number>();
  wsKeyList.forEach(k => wsStock.set(k, wsById.get(k) ?? 0));

  // Kelompokkan tiap output (per productId+warehouseId) jadi "lot", urut dari yang terbaru, lalu
  // alokasikan stok yang tersisa ke lot-lot itu mulai dari yang terbaru sampai stoknya habis dibagi.
  const lotsByKey = new Map<string, { batchId: string; yieldQty: number; createdAt: number }[]>();
  batches.forEach(b => {
    if (!b.warehouseId) return;
    (b.outputs ?? []).forEach(o => {
      const key = `${b.warehouseId}_${o.productId}`;
      const list = lotsByKey.get(key) ?? [];
      list.push({ batchId: b.id, yieldQty: o.yieldQty, createdAt: b.createdAt?.toMillis() ?? 0 });
      lotsByKey.set(key, list);
    });
  });
  const remainingByLot = new Map<string, number>(); // key: `${batchId}|${warehouseId}_${productId}`
  lotsByKey.forEach((lots, key) => {
    let pool = wsStock.get(key) ?? 0;
    [...lots].sort((a, b) => b.createdAt - a.createdAt).forEach(lot => {
      const take = Math.min(lot.yieldQty, pool);
      pool -= take;
      remainingByLot.set(`${lot.batchId}|${key}`, take);
    });
  });

  // Per output: "closed" (remaining 0 — habis), "mixed" (0 < remaining < yieldQty — sudah terjual
  // sebagian tapi belum habis, jadi tercampur/tidak murni lagi dari batch ini saja), atau "open"
  // (remaining == yieldQty — belum tersentuh sama sekali). Level batch: ada satu output "mixed" saja
  // sudah cukup bikin status batch jadi "mixed"; baru dianggap "closed" kalau SEMUA output closed.
  const batchesWithStatus = batches.map(b => {
    const outputs = b.outputs ?? [];
    if (!b.warehouseId || outputs.length === 0) return { ...b, closed: false, mixed: false };

    const outputStates = outputs.map(o => {
      const remaining = remainingByLot.get(`${b.id}|${b.warehouseId}_${o.productId}`) ?? 0;
      if (remaining <= 0) return 'closed';
      if (remaining < o.yieldQty) return 'mixed';
      return 'open';
    });
    const mixed  = outputStates.includes('mixed');
    const closed = !mixed && outputStates.every(s => s === 'closed');
    return { ...b, closed, mixed };
  });

  return Response.json({ batches: batchesWithStatus });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'production', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as {
    date?: string; note?: string; warehouseId?: string; warehouseName?: string;
    outputs: OutputInput[]; materialsUsed: MaterialUsedInput[]; otherCost?: number;
  };
  const materialsUsed = mergeMaterialsUsed(data.materialsUsed ?? []);
  const outputs = mergeOutputs(data.outputs ?? []).filter(o => o.yieldQty > 0);
  const otherCost = Number(data.otherCost) || 0;
  const date = data.date || new Date().toISOString().slice(0, 10);
  const warehouseId   = data.warehouseId ?? '';
  const warehouseName = data.warehouseName ?? '';
  if (materialsUsed.length === 0) return Response.json({ error: 'Minimal 1 bahan baku dipakai.' }, { status: 400 });
  if (outputs.length === 0) return Response.json({ error: 'Minimal 1 produk hasil dengan jumlah lebih dari 0.' }, { status: 400 });
  if (!warehouseId) return Response.json({ error: 'Pilih gudang tujuan.' }, { status: 400 });

  const db = getDb();
  const sql = getSql();
  const batchRef    = db.collection('productionBatches').doc();
  const materialRefs = materialsUsed.map(m => db.collection('rawMaterials').doc(m.materialId));
  const expenseId = randomUUID();

  // `rawMaterials` masih di Firestore (di luar cakupan Fase 2), sedang `products`/`warehouse_stock`/
  // `stock_ledger` sudah pindah ke Postgres (Tahap 8-10). Biaya bahan baku (materialCost) dibutuhkan
  // untuk hitung costPrice produk (Postgres) SEBELUM materialnya sendiri divalidasi & dipotong secara
  // otentik (Firestore, transaksional) — jadi urutannya di sini kebalikan dari checkout: baca material
  // biasa dulu (sekadar untuk avgCost, bukan pengecekan stok otoritatif) → kunci & update produk di
  // Postgres → baru validasi+potong material & tulis dokumen batch di Firestore (di sinilah pengecekan
  // stok bahan baku yang SEBENARNYA terjadi, dengan tx.get segar). Kalau langkah Firestore gagal
  // setelah Postgres berhasil, kompensasi (kembalikan produk ke kondisi semula) dijalankan.
  const materialSnaps = await db.getAll(...materialRefs);
  const shortages: string[] = [];
  materialsUsed.forEach((m, i) => {
    if (!materialSnaps[i].exists) { shortages.push(`${m.materialName} (bahan baku tidak ditemukan)`); return; }
    const stockQty = Number(materialSnaps[i].data()!.stockQty) || 0;
    if (stockQty < m.qty) shortages.push(`${m.materialName} (stok ${Math.round(stockQty * 100) / 100} ${m.unit}, butuh ${m.qty} ${m.unit})`);
  });
  if (shortages.length > 0) return Response.json({ error: `Stok bahan baku tidak cukup: ${shortages.join(', ')}` }, { status: 400 });

  const materialsWithCost = materialsUsed.map((m, i) => {
    const costPerUnit = Number(materialSnaps[i].data()!.avgCost) || 0;
    return { ...m, costPerUnit, cost: costPerUnit * m.qty };
  });
  const materialCost  = materialsWithCost.reduce((s, m) => s + m.cost, 0);
  const totalCost     = materialCost + otherCost;
  const totalYieldQty = outputs.reduce((s, o) => s + o.yieldQty, 0);
  // Biaya dari satu batch bahan baku dibagi rata per pcs ke semua produk hasil
  // (mis. Ori & Pedas dari adonan yang sama) — HPP/pcs dianggap seragam antar varian.
  const costPerPcs = totalCost / totalYieldQty;
  const outputsWithCost = outputs.map(o => ({ ...o, costPerPcs }));

  interface ProductSnapshot { productId: string; oldQty: number; oldCost: number; openPO: boolean }
  const productSnapshots: ProductSnapshot[] = [];
  let stockCommitted = false;

  try {
    await sql.begin(async pgTx => {
      const productIds = outputs.map(o => o.productId);
      const rows = await pgTx<{ id: string; stock_qty: string; cost_price: string | null; open_po: boolean }[]>`
        select id, stock_qty, cost_price, open_po from products where id in ${pgTx(productIds)} order by id for update
      `;
      const byId = new Map(rows.map(r => [r.id, r]));
      outputs.forEach(o => { if (!byId.has(o.productId)) throw new Error(`Produk "${o.productName}" tidak ditemukan.`); });

      for (const o of outputs) {
        const row = byId.get(o.productId)!;
        const oldQty  = Number(row.stock_qty) || 0;
        const oldCost = row.cost_price != null ? Number(row.cost_price) : 0;
        const newQty  = oldQty + o.yieldQty;
        const newCost = newQty > 0 ? (oldQty * oldCost + o.yieldQty * costPerPcs) / newQty : costPerPcs;
        const newStock = row.open_po ? 'open_po' : newQty > 0 ? 'ready' : 'habis';
        await pgTx`update products set stock_qty = ${newQty}, cost_price = ${newCost}, stock = ${newStock}, updated_at = now() where id = ${o.productId}`;

        await pgTx`
          insert into warehouse_stock (id, warehouse_id, product_id, product_name, stock_qty, updated_at)
          values (${`${warehouseId}_${o.productId}`}, ${warehouseId}, ${o.productId}, ${o.productName}, ${o.yieldQty}, now())
          on conflict (id) do update set
            stock_qty = warehouse_stock.stock_qty + excluded.stock_qty,
            product_name = excluded.product_name,
            updated_at = now()
        `;
        await writeStockLedgerEntryPg(pgTx, {
          productId: o.productId, productName: o.productName, warehouseId, warehouseName, type: 'in', qty: o.yieldQty,
          note: `Hasil produksi${data.note ? ` - ${data.note}` : ''}`,
        });

        productSnapshots.push({ productId: o.productId, oldQty, oldCost, openPO: row.open_po });
      }
    });
    stockCommitted = true;
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan produksi.' }, { status: 400 });
  }

  const pushPayloads: { title: string; message: string }[] = [];
  try {
    await db.runTransaction(async tx => {
      const freshMaterialSnaps = await Promise.all(materialRefs.map(r => tx.get(r)));
      const freshShortages: string[] = [];
      materialsUsed.forEach((m, i) => {
        if (!freshMaterialSnaps[i].exists) { freshShortages.push(`${m.materialName} (bahan baku tidak ditemukan)`); return; }
        const stockQty = Number(freshMaterialSnaps[i].data()!.stockQty) || 0;
        if (stockQty < m.qty) freshShortages.push(`${m.materialName} (stok ${Math.round(stockQty * 100) / 100} ${m.unit}, butuh ${m.qty} ${m.unit})`);
      });
      if (freshShortages.length > 0) throw new Error(`Stok bahan baku tidak cukup: ${freshShortages.join(', ')}`);

      materialsUsed.forEach((m, i) => {
        const material = freshMaterialSnaps[i].data()!;
        const oldQty = Number(material.stockQty) || 0;
        const newQty = oldQty - m.qty;
        const minStock = Number(material.minStock) || 0;
        tx.update(materialRefs[i], { stockQty: newQty, updatedAt: FieldValue.serverTimestamp() });

        // Notifikasi hanya saat baru MELEWATI ambang minimum, bukan tiap kali produksi jalan
        // selagi stoknya sudah rendah — supaya tidak spam.
        if (!isMaterialLowStock({ stockQty: oldQty, minStock }) && isMaterialLowStock({ stockQty: newQty, minStock })) {
          pushPayloads.push(writeNotification(tx, db, {
            type: 'stock_low',
            title: 'Stok bahan baku menipis',
            message: `${m.materialName} tersisa ${newQty} ${m.unit} (batas minimum ${minStock} ${m.unit}) — dari produksi oleh ${guard.username}.`,
            link: 'materials',
            entityCollection: 'rawMaterials', entityId: materialRefs[i].id,
            actor: guard,
          }));
        }
      });

      const batchData = {
        date, outputs: outputsWithCost,
        materialsUsed: materialsWithCost,
        materialCost, otherCost, totalCost, totalYieldQty, costPerPcs,
        warehouseId, warehouseName,
        note: data.note ?? '',
        expenseId: otherCost > 0 ? expenseId : null,
        createdAt: FieldValue.serverTimestamp(),
      };
      tx.set(batchRef, batchData);
      writeHistoryEntry(tx, db, {
        entity: 'production', entityId: batchRef.id,
        entityLabel: `Produksi ${date} - ${outputsWithCost.map(o => o.productName).join(' & ') || batchRef.id}`,
        action: 'create', actor: guard, after: batchData,
      });
      // Expense (biaya lain) ditulis ke Postgres SETELAH transaksi ini commit — lihat src/lib/expenses-pg.ts.
    });
  } catch (err) {
    // Dokumen batch/material gagal tersimpan SETELAH stok produk Postgres sudah diperbarui —
    // kompensasi: kembalikan produk ke kondisi (qty/cost) semula sebelum produksi ini.
    if (stockCommitted) {
      try {
        await sql.begin(async pgTx => {
          for (const snap of productSnapshots) {
            const output = outputs.find(o => o.productId === snap.productId)!;
            const oldStock = snap.openPO ? 'open_po' : snap.oldQty > 0 ? 'ready' : 'habis';
            await pgTx`update products set stock_qty = ${snap.oldQty}, cost_price = ${snap.oldCost}, stock = ${oldStock}, updated_at = now() where id = ${snap.productId}`;
            await pgTx`
              update warehouse_stock set stock_qty = stock_qty - ${output.yieldQty}, updated_at = now()
              where id = ${`${warehouseId}_${snap.productId}`}
            `;
            await writeStockLedgerEntryPg(pgTx, {
              productId: snap.productId, productName: output.productName, warehouseId, warehouseName, type: 'out', qty: output.yieldQty,
              note: `Kompensasi — gagal simpan produksi (${err instanceof Error ? err.message : 'error'})`,
            });
          }
        });
      } catch (compErr) {
        console.error('CRITICAL: gagal kompensasi stok produk setelah produksi gagal tersimpan', compErr);
      }
    }
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan produksi.' }, { status: 400 });
  }

  if (otherCost > 0) {
    const productNames = outputs.map(o => o.productName).join(' & ');
    await insertExpensePg({
      id: expenseId,
      category: 'Produksi',
      description: `Biaya produksi - ${productNames}`,
      amount: otherCost,
      date,
      note: `Otomatis dari biaya lain (tenaga kerja/overhead) produksi ${totalYieldQty} pcs (${productNames})`,
      sourceType: 'production',
      sourceId: batchRef.id,
    });
    revalidateTag('admin-expenses', { expire: 0 });
  }

  await Promise.all(pushPayloads.map(p => sendPush(db, p))).catch(err => console.error('Failed to send push for low stock', err));
  after(() => revalidateStorefront('products'));

  return Response.json({ id: batchRef.id });
}
