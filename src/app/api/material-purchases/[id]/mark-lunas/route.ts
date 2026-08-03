import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { validateAdminAuth, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

type Ctx = { params: Promise<{ id: string }> };

// Tandai Lunas — baru di sini pengeluaran otomatis dibuat (uang benar-benar keluar sekarang),
// supaya tidak dobel hitung dengan pengeluaran yang seharusnya sudah dicatat kalau langsung lunas.
// Pakai tanggal pembelian yang sudah diisi manual (bisa mundur), bukan tanggal hari ini.
export async function POST(req: NextRequest, ctx: Ctx) {
  if (!validateAdminAuth(req)) return unauthorized();
  const { id } = await ctx.params;
  const db = getDb();
  const purchaseRef = db.collection('materialPurchases').doc(id);
  const expenseRef  = db.collection('expenses').doc();

  try {
    await db.runTransaction(async tx => {
      const snap = await tx.get(purchaseRef);
      if (!snap.exists) throw new Error('Pembelian tidak ditemukan.');
      const purchase = snap.data()!;
      if (purchase.paymentStatus !== 'belum_lunas') return; // sudah lunas, tidak perlu apa-apa

      tx.update(purchaseRef, { paymentStatus: 'lunas', expenseId: expenseRef.id, updatedAt: FieldValue.serverTimestamp() });
      const total = Number(purchase.total) || 0;
      if (total > 0) {
        const items = (purchase.items as { materialName: string }[] | undefined) ?? [];
        const date = (purchase.date as string | undefined) || new Date().toISOString().slice(0, 10);
        tx.set(expenseRef, {
          category: 'Bahan Baku',
          description: `Pembelian bahan baku - ${purchase.supplierName || 'Tanpa nama'}`,
          amount: total,
          date,
          note: `Otomatis dari pembelian bahan baku (${items.map(it => it.materialName).join(', ')}) — ditandai lunas`,
          sourceType: 'material-purchase',
          sourceId: id,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menandai lunas.' }, { status: 400 });
  }

  return Response.json({ ok: true });
}
