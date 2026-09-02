import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { rowToPurchase, type PurchaseRow } from '@/lib/materials-pg';

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
  const sql = getSql();

  let before: ReturnType<typeof rowToPurchase>;
  let purchaseUpdate: Record<string, unknown>;
  let expenseDeleted: boolean;

  try {
    ({ before, purchaseUpdate, expenseDeleted } = await sql.begin(async pgTx => {
      const [row] = await pgTx<PurchaseRow[]>`select * from material_purchases where id = ${id} for update`;
      if (!row) throw new Error('Pembelian tidak ditemukan.');
      const purchase = rowToPurchase(row);
      if (purchase.voided) throw new Error('Pembelian ini sudah dibatalkan sebelumnya.');

      let deleted = false;
      if (purchase.expenseId) {
        const [expenseRow] = await pgTx<{ id: string }[]>`select id from expenses where id = ${purchase.expenseId}`;
        if (expenseRow) {
          await pgTx`delete from expenses where id = ${purchase.expenseId}`;
          deleted = true;
        }
      }

      const voidNote = note?.trim() ?? '';
      await pgTx`
        update material_purchases set
          voided = true, voided_at = now(), void_note = ${voidNote},
          payment_status = 'belum_lunas', expense_id = null, updated_at = now()
        where id = ${id}
      `;
      return {
        before: purchase,
        purchaseUpdate: { voided: true, voidNote, paymentStatus: 'belum_lunas', expenseId: null },
        expenseDeleted: deleted,
      };
    }));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal membatalkan pembelian.' }, { status: 400 });
  }

  try {
    await logHistory(db, {
      entity: 'material-purchases',
      entityId: id,
      entityLabel: `${before.supplierName?.trim() || 'Tanpa nama'} - Rp${before.total}`,
      action: 'update',
      actor: guard,
      before,
      after: { ...before, ...purchaseUpdate },
    });
  } catch (err) {
    console.error('Failed to write history for material purchase void', err);
  }
  if (expenseDeleted) revalidateTag('admin-expenses', { expire: 0 });

  return Response.json({ ok: true });
}
