import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

interface MaterialUsedInput { materialId: string; materialName: string; unit: string; qty: number }
interface OutputInput { productId: string; productName: string; yieldQty: number }

export async function GET(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get('limit') ?? '50');
  const snap = await getDb().collection('productionBatches').orderBy('createdAt', 'desc').limit(limit).get();
  const batches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ batches });
}

export async function POST(req: NextRequest) {
  if (!validateAdminAuth(req)) return unauthorized();
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
        const stockQty = Number(materialSnaps[i].data()!.stockQty) || 0;
        tx.update(materialRefs[i], { stockQty: stockQty - m.qty, updatedAt: FieldValue.serverTimestamp() });
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

      tx.set(batchRef, {
        date, outputs: outputsWithCost,
        materialsUsed: materialsWithCost,
        materialCost, otherCost, totalCost, totalYieldQty, costPerPcs,
        warehouseId, warehouseName,
        note: data.note ?? '',
        expenseId: otherCost > 0 ? expenseRef.id : null,
        createdAt: FieldValue.serverTimestamp(),
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

  return Response.json({ id: batchRef.id });
}
