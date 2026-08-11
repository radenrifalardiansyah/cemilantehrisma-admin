import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';

type Ctx = { params: Promise<{ id: string }> };

// Koreksi langsung stok & harga rata-rata bahan baku ke angka yang benar SEKARANG — tanpa
// menulis ulang riwayat pembelian/produksi yang sudah terkunci. Dipakai kalau ada kesalahan
// input lama yang sudah tidak bisa diedit lagi karena bahan bakunya sudah dipakai/dibeli lagi.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as { newStockQty?: number; newAvgCost?: number; note: string };
  if (!data.note?.trim()) return Response.json({ error: 'Catatan/alasan koreksi wajib diisi.' }, { status: 400 });

  const db = getDb();
  const materialRef   = db.collection('rawMaterials').doc(id);
  const adjustmentRef = db.collection('materialAdjustments').doc();

  try {
    await db.runTransaction(async tx => {
      const snap = await tx.get(materialRef);
      if (!snap.exists) throw new Error('Bahan baku tidak ditemukan.');
      const m = snap.data()!;
      const oldStockQty = Number(m.stockQty) || 0;
      const oldAvgCost  = Number(m.avgCost) || 0;
      const newStockQty = data.newStockQty != null ? Number(data.newStockQty) : oldStockQty;
      const newAvgCost  = data.newAvgCost  != null ? Number(data.newAvgCost)  : oldAvgCost;

      tx.update(materialRef, {
        stockQty: Math.max(0, newStockQty),
        avgCost: Math.max(0, newAvgCost),
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.set(adjustmentRef, {
        materialId: id, materialName: m.name ?? '', unit: m.unit ?? '',
        oldStockQty, newStockQty, oldAvgCost, newAvgCost,
        note: data.note.trim(),
        createdAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menyimpan koreksi.' }, { status: 400 });
  }

  return Response.json({ ok: true });
}
