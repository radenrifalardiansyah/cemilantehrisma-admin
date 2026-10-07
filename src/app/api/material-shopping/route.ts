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
  // Bisa satu item (materialId/qty/price) atau banyak sekaligus (items[]) dengan keterangan toko yang sama.
  const data = await req.json() as {
    items?: { materialId?: string; qty?: number; price?: number | null }[];
    materialId?: string; qty?: number; price?: number | null; note?: string;
  };
  const input = Array.isArray(data.items) ? data.items : [{ materialId: data.materialId, qty: data.qty, price: data.price }];
  if (input.length === 0) return Response.json({ error: 'Minimal 1 bahan baku.' }, { status: 400 });
  if (input.length > 100) return Response.json({ error: 'Maksimal 100 item sekali tambah.' }, { status: 400 });

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

  const note = data.note?.trim().slice(0, 200) || null;
  await sql.begin(async tx => {
    for (const p of parsed) {
      await tx`
        insert into material_shopping_items (id, material_id, qty, price, note, created_by)
        values (${randomUUID()}, ${p.materialId}, ${p.qty}, ${p.price}, ${note}, ${guard.username})
      `;
    }
  });
  return Response.json({ created: parsed.length });
}
