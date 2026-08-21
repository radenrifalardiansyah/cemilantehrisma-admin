import { NextRequest, after } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { writeHistoryEntry } from '@/lib/history';
import { writeNotification, sendPush } from '@/lib/notifications';
import { isMaterialLowStock } from '@/lib/stock-helpers';
import { revalidateStorefront } from '@/lib/revalidate';

interface MaterialUsedInput { materialId: string; materialName: string; unit: string; qty: number }
interface OutputInput { productId: string; productName: string; yieldQty: number }
interface BatchWithMeta { id: string; warehouseId?: string; outputs?: { productId: string; yieldQty: number }[]; createdAt?: Timestamp }

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'production', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get('limit') ?? '50');
  const db = getDb();
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
  const wsSnaps = wsKeyList.length > 0
    ? await db.getAll(...wsKeyList.map(k => db.collection('warehouse_stock').doc(k)))
    : [];
  const wsStock = new Map<string, number>();
  wsKeyList.forEach((k, i) => wsStock.set(k, Number(wsSnaps[i].data()?.stockQty) || 0));

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
  const materialsUsed = data.materialsUsed ?? [];
  const outputs = (data.outputs ?? []).filter(o => (Number(o.yieldQty) || 0) > 0);
  const otherCost = Number(data.otherCost) || 0;
  const date = data.date || new Date().toISOString().slice(0, 10);
  const warehouseId   = data.warehouseId ?? '';
  const warehouseName = data.warehouseName ?? '';
  if (materialsUsed.length === 0) return Response.json({ error: 'Minimal 1 bahan baku dipakai.' }, { status: 400 });
  if (outputs.length === 0) return Response.json({ error: 'Minimal 1 produk hasil dengan jumlah lebih dari 0.' }, { status: 400 });
  if (!warehouseId) return Response.json({ error: 'Pilih gudang tujuan.' }, { status: 400 });

  const db = getDb();
  const batchRef    = db.collection('productionBatches').doc();
  const productRefs = outputs.map(o => db.collection('products').doc(o.productId));
  const warehouseStockRefs = outputs.map(o => db.collection('warehouse_stock').doc(`${warehouseId}_${o.productId}`));
  const stockLogRefs = outputs.map(() => db.collection('stock').doc());
  const expenseRef  = db.collection('expenses').doc();

  const pushPayloads: { title: string; message: string }[] = [];
  try {
    await db.runTransaction(async tx => {
      const materialRefs = materialsUsed.map(m => db.collection('rawMaterials').doc(m.materialId));
      const [materialSnaps, productSnaps] = await Promise.all([
        Promise.all(materialRefs.map(r => tx.get(r))),
        Promise.all(productRefs.map(r => tx.get(r))),
      ]);

      outputs.forEach((o, i) => {
        if (!productSnaps[i].exists) throw new Error(`Produk "${o.productName}" tidak ditemukan.`);
      });

      const shortages: string[] = [];
      materialsUsed.forEach((m, i) => {
        if (!materialSnaps[i].exists) { shortages.push(`${m.materialName} (bahan baku tidak ditemukan)`); return; }
        const stockQty = Number(materialSnaps[i].data()!.stockQty) || 0;
        if (stockQty < m.qty) shortages.push(`${m.materialName} (stok ${stockQty} ${m.unit}, butuh ${m.qty} ${m.unit})`);
      });
      if (shortages.length > 0) throw new Error(`Stok bahan baku tidak cukup: ${shortages.join(', ')}`);

      const materialsWithCost = materialsUsed.map((m, i) => {
        const costPerUnit = Number(materialSnaps[i].data()!.avgCost) || 0;
        return { ...m, costPerUnit, cost: costPerUnit * m.qty };
      });
      const materialCost   = materialsWithCost.reduce((s, m) => s + m.cost, 0);
      const totalCost      = materialCost + otherCost;
      const totalYieldQty  = outputs.reduce((s, o) => s + o.yieldQty, 0);
      // Biaya dari satu batch bahan baku dibagi rata per pcs ke semua produk hasil
      // (mis. Ori & Pedas dari adonan yang sama) — HPP/pcs dianggap seragam antar varian.
      const costPerPcs = totalCost / totalYieldQty;

      materialsUsed.forEach((m, i) => {
        const material = materialSnaps[i].data()!;
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

      const outputsWithCost = outputs.map((o, i) => {
        const product = productSnaps[i].data()!;
        const oldQty  = Number(product.stockQty) || 0;
        const oldCost = Number(product.costPrice) || 0;
        const newQty  = oldQty + o.yieldQty;
        const newCost = newQty > 0 ? (oldQty * oldCost + o.yieldQty * costPerPcs) / newQty : costPerPcs;
        tx.update(productRefs[i], {
          stockQty: newQty,
          costPrice: newCost,
          stock: product.openPO ? 'open_po' : newQty > 0 ? 'ready' : 'habis',
          updatedAt: FieldValue.serverTimestamp(),
        });

        // Stok hasil produksi masuk ke gudang tujuan (sama seperti stok-masuk manual di menu Gudang)
        tx.set(
          warehouseStockRefs[i],
          {
            warehouseId, productId: o.productId, productName: o.productName,
            stockQty: FieldValue.increment(o.yieldQty),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        tx.set(stockLogRefs[i], {
          warehouseId, warehouseName,
          productId: o.productId, productName: o.productName,
          type: 'in', qty: o.yieldQty,
          note: `Hasil produksi${data.note ? ` - ${data.note}` : ''}`,
          createdAt: FieldValue.serverTimestamp(),
        });

        return { ...o, costPerPcs };
      });

      const batchData = {
        date, outputs: outputsWithCost,
        materialsUsed: materialsWithCost,
        materialCost, otherCost, totalCost, totalYieldQty, costPerPcs,
        warehouseId, warehouseName,
        note: data.note ?? '',
        expenseId: otherCost > 0 ? expenseRef.id : null,
        createdAt: FieldValue.serverTimestamp(),
      };
      tx.set(batchRef, batchData);
      writeHistoryEntry(tx, db, {
        entity: 'production', entityId: batchRef.id,
        entityLabel: `Produksi ${date} - ${outputsWithCost.map(o => o.productName).join(' & ') || batchRef.id}`,
        action: 'create', actor: guard, after: batchData,
      });

      // Catat otomatis sebagai Pengeluaran — hanya biaya lain (tenaga kerja/overhead), pakai tanggal produksi
      // yang diisi manual (bisa mundur). Biaya bahan baku TIDAK ikut karena sudah tercatat saat pembelian bahan baku.
      if (otherCost > 0) {
        const productNames = outputs.map(o => o.productName).join(' & ');
        tx.set(expenseRef, {
          category: 'Produksi',
          description: `Biaya produksi - ${productNames}`,
          amount: otherCost,
          date,
          note: `Otomatis dari biaya lain (tenaga kerja/overhead) produksi ${totalYieldQty} pcs (${productNames})`,
          sourceType: 'production',
          sourceId: batchRef.id,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan produksi.' }, { status: 400 });
  }

  await Promise.all(pushPayloads.map(p => sendPush(db, p))).catch(err => console.error('Failed to send push for low stock', err));
  after(() => revalidateStorefront('products'));

  return Response.json({ id: batchRef.id });
}
