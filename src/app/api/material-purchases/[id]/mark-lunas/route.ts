import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { writeHistoryEntry } from '@/lib/history';
import { insertExpensePg } from '@/lib/expenses-pg';

type Ctx = { params: Promise<{ id: string }> };

// Tandai Lunas — baru di sini pengeluaran otomatis dibuat (uang benar-benar keluar sekarang),
// supaya tidak dobel hitung dengan pengeluaran yang seharusnya sudah dicatat kalau langsung lunas.
// Pakai tanggal pembelian yang sudah diisi manual (bisa mundur), bukan tanggal hari ini.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const purchaseRef = db.collection('materialPurchases').doc(id);
  const expenseId = randomUUID();
  let expensePayload: { amount: number; date: string; supplierName: string; itemNames: string[]; walletId: string | null } | null = null;

  try {
    await db.runTransaction(async tx => {
      const snap = await tx.get(purchaseRef);
      if (!snap.exists) throw new Error('Pembelian tidak ditemukan.');
      const purchase = snap.data()!;
      if (purchase.paymentStatus !== 'belum_lunas') return; // sudah lunas, tidak perlu apa-apa

      const purchaseUpdate = { paymentStatus: 'lunas', expenseId, updatedAt: FieldValue.serverTimestamp() };
      tx.update(purchaseRef, purchaseUpdate);
      const total = Number(purchase.total) || 0;
      if (total > 0) {
        const items = (purchase.items as { materialName: string }[] | undefined) ?? [];
        const date = (purchase.date as string | undefined) || new Date().toISOString().slice(0, 10);
        expensePayload = {
          amount: total, date,
          supplierName: purchase.supplierName || 'Tanpa nama',
          itemNames: items.map(it => it.materialName),
          walletId: purchase.walletId ?? null,
        };
      }

      writeHistoryEntry(tx, db, {
        entity: 'material-purchases',
        entityId: id,
        entityLabel: `${purchase.supplierName?.toString().trim() || 'Tanpa nama'} - Rp${total}`,
        action: 'update',
        actor: guard,
        before: purchase,
        after: { ...purchase, ...purchaseUpdate },
      });
      // Expense ditulis ke Postgres SETELAH transaksi Firestore ini commit — lihat src/lib/expenses-pg.ts.
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal menandai lunas.' }, { status: 400 });
  }

  if (expensePayload) {
    const p = expensePayload as { amount: number; date: string; supplierName: string; itemNames: string[]; walletId: string | null };
    await insertExpensePg({
      id: expenseId,
      category: 'Bahan Baku',
      description: `Pembelian bahan baku - ${p.supplierName}`,
      amount: p.amount,
      date: p.date,
      note: `Otomatis dari pembelian bahan baku (${p.itemNames.join(', ')}) — ditandai lunas`,
      sourceType: 'material-purchase',
      sourceId: id,
      walletId: p.walletId,
    });
    revalidateTag('admin-expenses', { expire: 0 });
  }

  return Response.json({ ok: true });
}
