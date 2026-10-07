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

// Proses item Daftar Belanja yang dicentang jadi pembelian bahan baku — lewat createPurchaseTx
// yang sama dengan Pembelian manual (stok, harga rata-rata, pengeluaran). Dompet bisa dipilih
// per item (`itemWallets`); item dengan dompet yang sama digabung jadi satu pembelian, jadi satu
// proses bisa menghasilkan beberapa pembelian (semuanya dalam satu transaksi database).
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as {
    ids?: string[]; supplierId?: string; supplierName?: string; date?: string; note?: string;
    paymentStatus?: 'lunas' | 'belum_lunas'; walletId?: string | null; itemWallets?: Record<string, string>;
    // Qty & harga seperti yang tampil di layar saat menekan simpan. Disimpan di transaksi yang sama
    // sebelum diproses, supaya tidak balapan dengan simpan-saat-blur di klien (yang bisa belum selesai).
    items?: { id: string; qty: number; price: number | null }[];
  };
  const ids = Array.isArray(data.ids) ? data.ids : [];
  if (ids.length === 0) return Response.json({ error: 'Centang minimal 1 item.' }, { status: 400 });
  if (!data.supplierName?.trim()) return Response.json({ error: 'Nama toko/supplier wajib diisi.' }, { status: 400 });
  const paymentStatus = data.paymentStatus === 'belum_lunas' ? 'belum_lunas' : 'lunas';
  const date = data.date || wibDateKey(new Date());
  const itemWallets = data.itemWallets ?? {};
  const walletFor = (id: string) => itemWallets[id] || data.walletId || '';
  if (ids.some(id => !walletFor(id))) return Response.json({ error: 'Pilih dompet untuk semua item.' }, { status: 400 });

  const sql = getSql();
  const created: { purchaseId: string; data: Record<string, unknown> }[] = [];
  try {
    await sql.begin(async pgTx => {
      for (const it of data.items ?? []) {
        if (!ids.includes(it.id)) continue;
        const qty = Number(it.qty);
        const price = it.price == null ? null : Number(it.price);
        if (!Number.isFinite(qty) || qty <= 0) throw new Error('Qty harus lebih dari 0.');
        if (price != null && (!Number.isFinite(price) || price < 0)) throw new Error('Harga tidak valid.');
        await pgTx`update material_shopping_items set qty = ${qty}, price = ${price} where id = ${it.id} and status = 'pending'`;
      }
      // Kunci baris daftar supaya tidak diproses dua kali (mis. dobel klik / dua perangkat).
      const rows = await pgTx<{ id: string; material_id: string; qty: string; price: string | null; name: string; unit: string }[]>`
        select s.id, s.material_id, s.qty, s.price, m.name, m.unit
        from material_shopping_items s join raw_materials m on m.id = s.material_id
        where s.id in ${pgTx(ids)} and s.status = 'pending' order by s.created_at for update of s
      `;
      if (rows.length !== ids.length) throw new Error('Sebagian item sudah diproses atau dihapus. Muat ulang daftar.');

      // Kelompokkan per dompet → satu pembelian per dompet.
      const byWallet = new Map<string, { id: string; item: PurchaseItemInput }[]>();
      for (const r of rows) {
        const item: PurchaseItemInput = { materialId: r.material_id, materialName: r.name, unit: r.unit, qty: Number(r.qty), price: Number(r.price ?? 0) };
        const itemError = invalidPurchaseItemMessage([item]);
        if (itemError) throw new Error(itemError);
        if (!(item.price > 0)) throw new Error(`Harga "${item.materialName}" belum diisi.`);
        const w = walletFor(r.id);
        byWallet.set(w, [...(byWallet.get(w) ?? []), { id: r.id, item }]);
      }

      for (const [walletId, group] of byWallet) {
        const purchaseId = randomUUID();
        const purchaseData = await createPurchaseTx(pgTx, {
          purchaseId, expenseId: randomUUID(),
          supplierId: data.supplierId || null,
          supplierName: data.supplierName!.trim(),
          items: group.map(g => g.item), date, paymentStatus,
          note: data.note?.trim() || 'Dari Daftar Belanja',
          walletId,
        });
        await pgTx`
          update material_shopping_items set status = 'done', purchase_id = ${purchaseId}, done_at = now(), checked = true
          where id in ${pgTx(group.map(g => g.id))}
        `;
        created.push({ purchaseId, data: purchaseData });
      }
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Gagal memproses daftar belanja.' }, { status: 400 });
  }

  for (const c of created) {
    try {
      await logHistory(getDb(), {
        entity: 'material-purchases', entityId: c.purchaseId,
        entityLabel: `${data.supplierName!.trim()} - Rp${c.data.total} (Daftar Belanja)`,
        action: 'create', actor: guard, after: c.data,
      });
    } catch (err) {
      console.error('Failed to write history for shopping-list purchase', err);
    }
  }
  revalidateTag('admin-materials', { expire: 0 });
  if (created.some(c => c.data.expenseId)) revalidateTag('admin-expenses', { expire: 0 });
  revalidateTag('admin-analytics', { expire: 0 });
  return Response.json({ id: created[0]?.purchaseId, ids: created.map(c => c.purchaseId), purchases: created.length });
}
