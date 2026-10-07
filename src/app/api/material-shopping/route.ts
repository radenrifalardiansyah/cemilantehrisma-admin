import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { rowToShoppingItem, type ShoppingItemRow } from '@/lib/material-shopping';

// Daftar Belanja bahan baku — daftar yang disusun sebelum belanja ke toko/warung. Belum
// mengubah stok/keuangan; baru jadi pembelian lewat POST /process.

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'view');
  if (guard instanceof Response) return guard;
  const sql = getSql();
  // Yang sudah diproses ikut dikirim (50 terakhir) supaya riwayatnya tetap terlihat.
  // Seluruh daftar: yang masih menunggu + riwayat yang sudah diproses (termasuk hasil impor pembelian lama).
  const rows = await sql<ShoppingItemRow[]>`
    select s.*, m.name as material_name, m.unit as material_unit,
           p.wallet_id as purchase_wallet_id, p.payment_status as purchase_payment_status
    from material_shopping_items s join raw_materials m on m.id = s.material_id
    left join material_purchases p on p.id = s.purchase_id
    order by s.shopping_date desc, s.created_at asc
  `;
  return Response.json({ items: rows.map(rowToShoppingItem) });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'create');
  if (guard instanceof Response) return guard;
  // Satu daftar belanja = tanggal + supplier + banyak item. Daftar dengan tanggal & supplier yang
  // sama otomatis tergabung di tampilan (dikelompokkan di klien).
  const data = await req.json() as {
    date?: string; supplierId?: string; supplierName?: string; note?: string;
    items?: { materialId?: string; qty?: number; price?: number | null }[];
  };
  const input = Array.isArray(data.items) ? data.items : [];
  if (input.length === 0) return Response.json({ error: 'Minimal 1 bahan baku.' }, { status: 400 });
  if (input.length > 100) return Response.json({ error: 'Maksimal 100 item sekali tambah.' }, { status: 400 });
  if (!data.date || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) return Response.json({ error: 'Tanggal wajib diisi.' }, { status: 400 });

  const parsed: { materialId: string; qty: number; price: number | null }[] = [];
  for (const it of input) {
    const qty = Number(it.qty);
    if (!it.materialId) return Response.json({ error: 'Pilih bahan baku.' }, { status: 400 });
    if (!Number.isFinite(qty) || qty <= 0) return Response.json({ error: 'Qty harus lebih dari 0.' }, { status: 400 });
    const price = it.price == null || it.price === ('' as unknown) ? null : Number(it.price);
    if (price != null && (!Number.isFinite(price) || price < 0)) return Response.json({ error: 'Harga tidak valid.' }, { status: 400 });
    parsed.push({ materialId: it.materialId, qty, price });
  }

  const sql = getSql();
  const mats = await sql<{ id: string }[]>`select id from raw_materials where id in ${sql([...new Set(parsed.map(p => p.materialId))])}`;
  const known = new Set(mats.map(m => m.id));
  if (parsed.some(p => !known.has(p.materialId))) return Response.json({ error: 'Bahan baku tidak ditemukan.' }, { status: 400 });

  const supplierId = data.supplierId || null;
  const supplierName = (data.supplierName ?? '').trim().slice(0, 120);
  const note = data.note?.trim().slice(0, 200) || null;
  await sql.begin(async tx => {
    for (const p of parsed) {
      await tx`
        insert into material_shopping_items (id, material_id, qty, price, note, shopping_date, supplier_id, supplier_name, created_by)
        values (${randomUUID()}, ${p.materialId}, ${p.qty}, ${p.price}, ${note}, ${data.date!}, ${supplierId}, ${supplierName}, ${guard.username})
      `;
    }
  });
  return Response.json({ created: parsed.length });
}
