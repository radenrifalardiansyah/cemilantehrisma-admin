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
  const rows = await sql<ShoppingItemRow[]>`
    select * from (
      select s.*, m.name as material_name, m.unit as material_unit
      from material_shopping_items s join raw_materials m on m.id = s.material_id
      where s.status = 'pending'
      union all
      (select s.*, m.name as material_name, m.unit as material_unit
       from material_shopping_items s join raw_materials m on m.id = s.material_id
       where s.status = 'done' order by s.done_at desc limit 50)
    ) t order by status asc, created_at asc
  `;
  return Response.json({ items: rows.map(rowToShoppingItem) });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as { materialId?: string; qty?: number; price?: number | null; note?: string };
  const qty = Number(data.qty);
  if (!data.materialId) return Response.json({ error: 'Pilih bahan baku.' }, { status: 400 });
  if (!Number.isFinite(qty) || qty <= 0) return Response.json({ error: 'Qty harus lebih dari 0.' }, { status: 400 });
  const price = data.price == null || data.price === ('' as unknown) ? null : Number(data.price);
  if (price != null && (!Number.isFinite(price) || price < 0)) return Response.json({ error: 'Harga tidak valid.' }, { status: 400 });

  const sql = getSql();
  const [mat] = await sql<{ id: string }[]>`select id from raw_materials where id = ${data.materialId}`;
  if (!mat) return Response.json({ error: 'Bahan baku tidak ditemukan.' }, { status: 400 });
  const id = randomUUID();
  await sql`
    insert into material_shopping_items (id, material_id, qty, price, note, created_by)
    values (${id}, ${data.materialId}, ${qty}, ${price}, ${data.note?.trim().slice(0, 200) || null}, ${guard.username})
  `;
  return Response.json({ id });
}
