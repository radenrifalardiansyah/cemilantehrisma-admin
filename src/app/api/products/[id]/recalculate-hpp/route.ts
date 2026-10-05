import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql, parseJsonb } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';

type Ctx = { params: Promise<{ id: string }> };

// Timpa HPP (costPrice) yang SUDAH tersimpan di semua order & rekap konsinyasi lama yang
// mengandung produk ini dengan Harga Modal terkini — dipakai saat HPP lama diketahui salah input
// dan perlu dikoreksi retroaktif. Beda dari tombol "Hitung Ulang HPP" di Laporan Keuangan, yang
// cuma mengisi fallback untuk transaksi yang costPrice-nya kosong, bukan menimpa yang sudah ada
// (lihat effectiveCostPrice di FinanceReportTab.tsx — snapshot costPrice yang truthy selalu menang).
export async function POST(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'products', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const sql = getSql();

  const [productRow] = await sql<{ cost_price: string | null; name: string | null }[]>`
    select cost_price, name from products where id = ${id}
  `;
  if (!productRow) return Response.json({ error: 'Produk tidak ditemukan.' }, { status: 404 });
  const costPrice = productRow.cost_price != null ? Number(productRow.cost_price) : 0;
  const productName = productRow.name ?? '';

  // `orders` & `consignment_recaps` sudah di Postgres (Tahap 12 & 13 migrasi Fase 2 — lihat plan
  // gleaming-wondering-quokka.md) — jumlah baris masih kecil, jadi cukup scan semua & filter di JS,
  // sama seperti pola lama.
  let updatedOrders = 0;
  let updatedRecaps = 0;

  // Satu transaksi dengan `for update` pada baris yang disentuh: tiap baris dibaca ulang SETELAH
  // dikunci, sehingga edit/batal pesanan yang terjadi bersamaan tidak tertimpa items versi lama
  // (read-modify-write tanpa kunci sebelumnya membuang perubahan items milik transaksi lain).
  await sql.begin(async pgTx => {
    const hasProduct = (raw: unknown) => (parseJsonb(raw) as { productId?: string }[] | null)?.some(it => it.productId === id) ?? false;
    const orderIds = (await pgTx<{ id: string; items: unknown }[]>`select id, items from orders order by id`).filter(r => hasProduct(r.items));
    for (const { id: orderId } of orderIds) {
      const [row] = await pgTx<{ id: string; items: unknown }[]>`select id, items from orders where id = ${orderId} for update`;
      const items = parseJsonb(row.items) as { productId?: string; costPrice?: number }[] | null;
      if (!items?.some(it => it.productId === id)) continue;
      const newItems = items.map(it => (it.productId === id ? { ...it, costPrice } : it));
      await pgTx`update orders set items = ${JSON.stringify(newItems)}, updated_at = now() where id = ${row.id}`;
      updatedOrders++;
    }

    const recapIds = (await pgTx<{ id: string; items: unknown }[]>`select id, items from consignment_recaps order by id`).filter(r => hasProduct(r.items));
    for (const { id: recapId } of recapIds) {
      const [row] = await pgTx<{ id: string; items: unknown }[]>`select id, items from consignment_recaps where id = ${recapId} for update`;
      const items = parseJsonb(row.items) as { productId?: string; costPrice?: number; qtySold?: number }[] | null;
      if (!items?.some(it => it.productId === id)) continue;
      const newItems = items.map(it => (it.productId === id ? { ...it, costPrice, cogs: (it.qtySold ?? 0) * costPrice } : it));
      await pgTx`update consignment_recaps set items = ${JSON.stringify(newItems)}, updated_at = now() where id = ${row.id}`;
      updatedRecaps++;
    }
  });

  await logHistory(db, {
    entity: 'products',
    entityId: id,
    entityLabel: `Hitung Ulang HPP Retroaktif - ${productName}`,
    action: 'update',
    actor: guard,
    meta: { costPrice, updatedOrders, updatedRecaps },
  }).catch(err => console.error('Failed to log recalculate-hpp history', err));

  return Response.json({ ok: true, costPrice, updatedOrders, updatedRecaps });
}
