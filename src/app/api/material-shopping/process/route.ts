import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { createPurchaseTx, type PurchaseItemInput } from '@/lib/material-purchase-core';
import { invalidPurchaseItemMessage } from '@/lib/validate-items';
import { logHistory } from '@/lib/history';
import { wibDateKey } from '@/lib/date';

// Proses item Daftar Belanja yang dicentang jadi SATU pembelian bahan baku — lewat
// createPurchaseTx yang sama dengan Pembelian manual (stok, harga rata-rata, pengeluaran).
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as {
    ids?: string[]; supplierId?: string; supplierName?: string; date?: string; note?: string;
    paymentStatus?: 'lunas' | 'belum_lunas'; walletId?: string | null;
  };
  const ids = Array.isArray(data.ids) ? data.ids : [];
  if (ids.length === 0) return Response.json({ error: 'Centang minimal 1 item.' }, { status: 400 });
  if (!data.supplierName?.trim()) return Response.json({ error: 'Nama toko/supplier wajib diisi.' }, { status: 400 });
  if (!data.walletId) return Response.json({ error: 'Pilih dompet sumber.' }, { status: 400 });
  const paymentStatus = data.paymentStatus === 'belum_lunas' ? 'belum_lunas' : 'lunas';
  const date = data.date || wibDateKey(new Date());

  const sql = getSql();
  const purchaseId = randomUUID();
  const expenseId = randomUUID();
  let purchaseData: Record<string, unknown> = {};
  try {
    await sql.begin(async pgTx => {
      // Kunci baris daftar supaya tidak diproses dua kali (mis. dobel klik / dua perangkat).
      const rows = await pgTx<{ id: string; material_id: string; qty: string; price: string | null; name: string; unit: string }[]>`
        select s.id, s.material_id, s.qty, s.price, m.name, m.unit
        from material_shopping_items s join raw_materials m on m.id = s.material_id
        where s.id in ${pgTx(ids)} and s.status = 'pending' order by s.created_at for update of s
      `;
      if (rows.length !== ids.length) throw new Error('Sebagian item sudah diproses atau dihapus. Muat ulang daftar.');
      const items: PurchaseItemInput[] = rows.map(r => ({
        materialId: r.material_id, materialName: r.name, unit: r.unit, qty: Number(r.qty), price: Number(r.price ?? 0),
      }));
      const itemError = invalidPurchaseItemMessage(items);
      if (itemError) throw new Error(itemError);
      const noPrice = items.find(it => !(it.price > 0));
      if (noPrice) throw new Error(`Harga "${noPrice.materialName}" belum diisi.`);

      purchaseData = await createPurchaseTx(pgTx, {
        purchaseId, expenseId,
        supplierId: data.supplierId || null,
        supplierName: data.supplierName!.trim(),
        items, date, paymentStatus,
        note: data.note?.trim() || 'Dari Daftar Belanja',
        walletId: data.walletId ?? null,
      });
      await pgTx`
        update material_shopping_items set status = 'done', purchase_id = ${purchaseId}, done_at = now(), checked = true
        where id in ${pgTx(ids)}
      `;
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal memproses daftar belanja.' }, { status: 400 });
  }

  try {
    await logHistory(getDb(), {
      entity: 'material-purchases', entityId: purchaseId,
      entityLabel: `${data.supplierName!.trim()} - Rp${purchaseData.total} (Daftar Belanja)`,
      action: 'create', actor: guard, after: purchaseData,
    });
  } catch (err) {
    console.error('Failed to write history for shopping-list purchase', err);
  }
  revalidateTag('admin-materials', { expire: 0 });
  if (purchaseData.expenseId) revalidateTag('admin-expenses', { expire: 0 });
  revalidateTag('admin-analytics', { expire: 0 });
  return Response.json({ id: purchaseId });
}
