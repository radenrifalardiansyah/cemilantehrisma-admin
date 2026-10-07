import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { voidPurchaseTx, type VoidPurchaseResult } from '@/lib/material-purchase-core';

// Kembalikan item Daftar Belanja yang sudah diproses ke status Menunggu. Pembelian yang dibuat
// dari proses itu DIBATALKAN (void) lewat voidPurchaseTx yang sama dengan tombol Batalkan di
// Pembelian — stok, harga rata-rata, dan pengeluaran dikembalikan. Kalau pengembalian stok tidak
// aman (bahan sudah dipakai/dibeli lagi setelahnya), seluruh proses di-rollback supaya tidak ada
// pembelian ganda saat daftar diproses ulang.
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'edit');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids?: string[] };
  if (!Array.isArray(ids) || ids.length === 0) return Response.json({ error: 'Tidak ada item.' }, { status: 400 });

  const sql = getSql();
  const voided: { id: string; before: VoidPurchaseResult['before']; update: Record<string, unknown>; expenseDeleted: boolean }[] = [];
  try {
    await sql.begin(async pgTx => {
      const rows = await pgTx<{ id: string; purchase_id: string | null; created_by: string | null }[]>`
        select id, purchase_id, created_by from material_shopping_items
        where id in ${pgTx(ids)} and status = 'done' for update
      `;
      if (rows.length === 0) throw new Error('Tidak ada item yang sudah diproses.');
      if (rows.some(r => r.created_by === 'import-pembelian')) {
        throw new Error('Daftar ini berasal dari impor pembelian lama — ubah atau batalkan lewat tab Pembelian.');
      }
      const purchaseIds = [...new Set(rows.map(r => r.purchase_id).filter((p): p is string => !!p))];
      for (const pid of purchaseIds) {
        const [gr] = await pgTx<{ gr_id: string | null }[]>`select gr_id from material_purchases where id = ${pid}`;
        if (gr?.gr_id) throw new Error('Pembelian berasal dari Penerimaan Barang (GR) — batalkan lewat GR-nya.');
        const r = await voidPurchaseTx(pgTx, pid, 'Dikembalikan ke Menunggu dari Daftar Belanja');
        if (!r.reversed) {
          throw new Error(`Stok tidak aman dikembalikan (${r.skippedMaterials.join(', ') || 'bahan baku'} sudah dipakai/dibeli lagi setelahnya). Tidak ada yang diubah — koreksi lewat tab Pembelian atau menu Stok.`);
        }
        voided.push({ id: pid, before: r.before, update: r.purchaseUpdate, expenseDeleted: r.expenseDeleted });
      }
      // Semua item dari pembelian yang dibatalkan kembali menunggu (satu pembelian bisa memuat beberapa item).
      await pgTx`
        update material_shopping_items set status = 'pending', checked = false, purchase_id = null, done_at = null
        where purchase_id in ${pgTx(purchaseIds)} or id in ${pgTx(rows.map(r => r.id))}
      `;
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal mengembalikan ke Menunggu.' }, { status: 400 });
  }

  for (const v of voided) {
    try {
      await logHistory(getDb(), {
        entity: 'material-purchases', entityId: v.id,
        entityLabel: `${v.before.supplierName?.trim() || 'Tanpa nama'} - Rp${v.before.total} (dikembalikan ke Menunggu)`,
        action: 'update', actor: guard, before: v.before, after: { ...v.before, ...v.update },
      });
    } catch (err) {
      console.error('Failed to write history for shopping-list reopen', err);
    }
  }
  revalidateTag('admin-materials', { expire: 0 });
  if (voided.some(v => v.expenseDeleted)) revalidateTag('admin-expenses', { expire: 0 });
  revalidateTag('admin-analytics', { expire: 0 });
  return Response.json({ ok: true, purchases: voided.length });
}
