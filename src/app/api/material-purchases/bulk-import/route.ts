import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { logHistory } from '@/lib/history';

interface ImportRow {
  materialId: string; materialName: string; unit: string; qty: number; price: number;
  supplierName?: string; date?: string; note?: string; paymentStatus?: 'lunas' | 'belum_lunas';
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'create');
  if (guard instanceof Response) return guard;
  const { purchases } = await req.json() as { purchases: ImportRow[] };
  if (!Array.isArray(purchases) || purchases.length === 0) {
    return Response.json({ error: 'Tidak ada data pembelian untuk diimpor.' }, { status: 400 });
  }

  const db = getDb();
  let created = 0, skippedInvalid = 0;

  // Diproses satu per satu (bukan Promise.all) supaya update stok & harga rata-rata bahan baku
  // yang sama di baris berurutan tetap akurat — tiap baris harus melihat hasil baris sebelumnya.
  for (const row of purchases) {
    const qty = Number(row.qty) || 0;
    const price = Number(row.price) || 0;
    if (!row.materialId || qty <= 0 || price < 0) { skippedInvalid++; continue; }

    const paymentStatus = row.paymentStatus === 'belum_lunas' ? 'belum_lunas' : 'lunas';
    const date = row.date || new Date().toISOString().slice(0, 10);
    const materialRef = db.collection('rawMaterials').doc(row.materialId);
    const purchaseRef = db.collection('materialPurchases').doc();
    const expenseRef  = db.collection('expenses').doc();

    try {
      await db.runTransaction(async tx => {
        const materialSnap = await tx.get(materialRef);
        if (!materialSnap.exists) throw new Error('not-found');

        const m = materialSnap.data()!;
        const oldQty = Number(m.stockQty) || 0;
        const oldAvg = Number(m.avgCost) || 0;
        const newQty = oldQty + qty;
        const newAvg = newQty > 0 ? (oldQty * oldAvg + qty * price) / newQty : 0;
        tx.update(materialRef, { stockQty: newQty, avgCost: newAvg, updatedAt: FieldValue.serverTimestamp() });

        const subtotal = qty * price;
        const willCreateExpense = subtotal > 0 && paymentStatus === 'lunas';

        tx.set(purchaseRef, {
          supplierId: null,
          supplierName: (row.supplierName ?? '').toString().trim(),
          items: [{ materialId: row.materialId, materialName: row.materialName, unit: row.unit, qty, price, subtotal }],
          total: subtotal,
          date,
          paymentStatus,
          expenseId: willCreateExpense ? expenseRef.id : null,
          note: (row.note ?? '').toString().trim(),
          createdAt: FieldValue.serverTimestamp(),
        });

        if (willCreateExpense) {
          tx.set(expenseRef, {
            category: 'Bahan Baku',
            description: `Pembelian bahan baku - ${row.supplierName || 'Tanpa nama'}`,
            amount: subtotal,
            date,
            note: `Otomatis dari pembelian bahan baku (${row.materialName})`,
            sourceType: 'material-purchase',
            sourceId: purchaseRef.id,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      });
      created++;
    } catch {
      skippedInvalid++;
    }
  }

  try {
    await logHistory(db, {
      entity: 'material-purchases',
      entityId: `bulk-${Date.now()}`,
      entityLabel: `Impor massal ${created} pembelian bahan`,
      action: 'create',
      actor: guard,
      meta: { bulk: true, createdCount: created, rowCount: purchases.length },
    });
  } catch {
    // kegagalan menulis audit log tidak boleh menggagalkan hasil impor yang sudah terjadi
  }

  return Response.json({ created, skippedInvalid });
}
