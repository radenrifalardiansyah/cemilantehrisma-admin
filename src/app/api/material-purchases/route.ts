import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';

interface PurchaseItemInput {
  materialId: string; materialName: string; unit: string;
  qty: number; price: number;
}

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get('limit') ?? '50');
  const snap = await getDb().collection('materialPurchases').orderBy('createdAt', 'desc').limit(limit).get();
  const purchases = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return Response.json({ purchases });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as {
    supplierId?: string; supplierName: string; date?: string; note?: string; items: PurchaseItemInput[];
    paymentStatus?: 'lunas' | 'belum_lunas';
  };
  const items = data.items ?? [];
  if (items.length === 0) return Response.json({ error: 'Minimal 1 bahan baku.' }, { status: 400 });
  const paymentStatus = data.paymentStatus === 'belum_lunas' ? 'belum_lunas' : 'lunas';
  const date = data.date || new Date().toISOString().slice(0, 10);

  const db = getDb();
  const purchaseRef = db.collection('materialPurchases').doc();
  const expenseRef  = db.collection('expenses').doc();

  try {
    await db.runTransaction(async tx => {
      const materialRefs = items.map(it => db.collection('rawMaterials').doc(it.materialId));
      const materialSnaps = await Promise.all(materialRefs.map(r => tx.get(r)));

      const itemsWithSubtotal = items.map((it, i) => {
        if (!materialSnaps[i].exists) throw new Error(`Bahan baku "${it.materialName}" tidak ditemukan.`);
        return { ...it, subtotal: it.qty * it.price };
      });
      const total = itemsWithSubtotal.reduce((s, it) => s + it.subtotal, 0);

      items.forEach((it, i) => {
        const m = materialSnaps[i].data()!;
        const oldQty = Number(m.stockQty) || 0;
        const oldAvg = Number(m.avgCost) || 0;
        const newQty = oldQty + it.qty;
        const newAvg = newQty > 0 ? (oldQty * oldAvg + it.qty * it.price) / newQty : 0;
        tx.update(materialRefs[i], { stockQty: newQty, avgCost: newAvg, updatedAt: FieldValue.serverTimestamp() });
      });

      // Catat otomatis sebagai Pengeluaran (uang keluar beneran saat beli bahan baku) — cuma kalau
      // sudah lunas. Kalau belum lunas, pengeluaran baru dicatat saat ditandai lunas (lihat [id]/route.ts),
      // supaya Jurnal Kas/Laba Rugi tidak menghitung uang yang belum benar-benar keluar.
      const willCreateExpense = total > 0 && paymentStatus === 'lunas';

      tx.set(purchaseRef, {
        supplierId: data.supplierId ?? null,
        supplierName: data.supplierName ?? '',
        items: itemsWithSubtotal,
        total,
        date,
        paymentStatus,
        expenseId: willCreateExpense ? expenseRef.id : null,
        note: data.note ?? '',
        createdAt: FieldValue.serverTimestamp(),
      });

      if (willCreateExpense) {
        tx.set(expenseRef, {
          category: 'Bahan Baku',
          description: `Pembelian bahan baku - ${data.supplierName || 'Tanpa nama'}`,
          amount: total,
          date,
          note: `Otomatis dari pembelian bahan baku (${itemsWithSubtotal.map(it => it.materialName).join(', ')})`,
          sourceType: 'material-purchase',
          sourceId: purchaseRef.id,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan pembelian.' }, { status: 400 });
  }

  return Response.json({ id: purchaseRef.id });
}
