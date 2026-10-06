import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { voidPurchaseTx, type VoidPurchaseResult } from '@/lib/material-purchase-core';

type Ctx = { params: Promise<{ id: string }> };

// Batalkan (void) — jalan keluar kalau Hapus/Edit diblokir karena bahan baku sudah dipakai/dibeli
// lagi. Beda dari Hapus: baris pembelian TETAP ADA (ditandai voided) untuk jejak audit, bukan
// dihapus permanen. Stok & harga rata-rata dikembalikan dengan rumus reversal yang SAMA seperti
// DELETE — TAPI hanya kalau aman (belum ada pembelian/produksi lain yang menyentuh bahan baku yang
// sama setelah transaksi ini, sama seperti guard di PUT/DELETE). Kalau tidak aman, reversal
// dilewati (stok dibiarkan apa adanya) dan itu dilaporkan balik ke client lewat `reversed`/
// `skippedMaterials`, supaya UI bisa memberi tahu user secara akurat apakah stok betul-betul sudah
// dibetulkan atau masih perlu Koreksi manual di menu Stok.
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const { note } = await req.json().catch(() => ({})) as { note?: string };
  const db = getDb();
  const sql = getSql();

  let before: VoidPurchaseResult['before'];
  let purchaseUpdate: Record<string, unknown>;
  let expenseDeleted: boolean;
  let reversed: boolean;
  let skippedMaterials: string[];

  try {
    ({ before, purchaseUpdate, expenseDeleted, reversed, skippedMaterials } = await sql.begin(async pgTx => {
      const [gr] = await pgTx<{ gr_id: string | null }[]>`select gr_id from material_purchases where id = ${id}`;
      if (gr?.gr_id) throw new Error('Pembelian ini berasal dari Penerimaan Barang (GR) — batalkan lewat GR-nya supaya status PO ikut benar.');
      return voidPurchaseTx(pgTx, id, note?.trim() ?? '');
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
      meta: { stockReversed: reversed, skippedMaterials },
    });
  } catch (err) {
    console.error('Failed to write history for material purchase void', err);
  }
  if (reversed) revalidateTag('admin-materials', { expire: 0 });
  if (expenseDeleted) revalidateTag('admin-expenses', { expire: 0 });
  revalidateTag('admin-analytics', { expire: 0 });

  return Response.json({ ok: true, reversed, skippedMaterials });
}
