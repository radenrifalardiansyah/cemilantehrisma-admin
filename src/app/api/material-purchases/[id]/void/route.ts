import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { writeHistoryEntry } from '@/lib/history';
import { getExpensePg, deleteExpensePg } from '@/lib/expenses-pg';

type Ctx = { params: Promise<{ id: string }> };

// Batalkan (void) — jalan keluar kalau Hapus/Edit diblokir karena bahan baku sudah dipakai/dibeli
// lagi. BEDA dari Hapus: stok & harga rata-rata bahan baku TIDAK dikembalikan (supaya tidak merusak
// angka yang sudah dipakai transaksi lain) — cuma menghapus keterkaitan uangnya (Pengeluaran otomatis,
// kalau ada) dan menandai transaksi ini sebagai batal/tidak berlaku lagi. Kalau stok sekarang perlu
// dibetulkan gara-gara ini, pakai /api/materials/[id]/adjust setelahnya.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const { note } = await req.json().catch(() => ({})) as { note?: string };
  const db = getDb();
  const purchaseRef = db.collection('materialPurchases').doc(id);
  let expenseIdToDelete: string | null = null;

  try {
    await db.runTransaction(async tx => {
      const snap = await tx.get(purchaseRef);
      if (!snap.exists) throw new Error('Pembelian tidak ditemukan.');
      const purchase = snap.data()!;
      if (purchase.voided) throw new Error('Pembelian ini sudah dibatalkan sebelumnya.');

      // expenses sudah pindah ke Postgres (Tahap 5) — baca di sini best-effort, dihapus SETELAH
      // transaksi Firestore ini commit (lihat src/lib/expenses-pg.ts).
      const expenseId = purchase.expenseId as string | null | undefined;
      const expenseRow = expenseId ? await getExpensePg(expenseId) : null;
      if (expenseRow) expenseIdToDelete = expenseId!;

      const purchaseUpdate = {
        voided: true,
        voidedAt: FieldValue.serverTimestamp(),
        voidNote: note?.trim() ?? '',
        paymentStatus: 'belum_lunas',
        expenseId: null,
        updatedAt: FieldValue.serverTimestamp(),
      };
      tx.update(purchaseRef, purchaseUpdate);

      writeHistoryEntry(tx, db, {
        entity: 'material-purchases',
        entityId: id,
        entityLabel: `${purchase.supplierName?.toString().trim() || 'Tanpa nama'} - Rp${Number(purchase.total) || 0}`,
        action: 'update',
        actor: guard,
        before: purchase,
        after: { ...purchase, ...purchaseUpdate },
      });
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal membatalkan pembelian.' }, { status: 400 });
  }

  if (expenseIdToDelete) {
    await deleteExpensePg(expenseIdToDelete);
    revalidateTag('admin-expenses', { expire: 0 });
  }

  return Response.json({ ok: true });
}
