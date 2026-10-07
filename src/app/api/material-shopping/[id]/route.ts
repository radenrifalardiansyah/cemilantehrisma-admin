import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

type Ctx = { params: Promise<{ id: string }> };

// Ubah item yang masih di daftar (qty, harga, catatan, centang). Item yang sudah diproses terkunci.
export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as { qty?: number; price?: number | null; note?: string; checked?: boolean };
  const sql = getSql();
  const [row] = await sql<{ status: string }[]>`select status from material_shopping_items where id = ${id}`;
  if (!row) return Response.json({ error: 'Item tidak ditemukan.' }, { status: 404 });
  if (row.status !== 'pending') return Response.json({ error: 'Item sudah diproses.' }, { status: 400 });

  if (data.qty !== undefined && (!Number.isFinite(Number(data.qty)) || Number(data.qty) <= 0)) {
    return Response.json({ error: 'Qty harus lebih dari 0.' }, { status: 400 });
  }
  if (data.price != null && (!Number.isFinite(Number(data.price)) || Number(data.price) < 0)) {
    return Response.json({ error: 'Harga tidak valid.' }, { status: 400 });
  }
  await sql`
    update material_shopping_items set
      qty = ${data.qty !== undefined ? Number(data.qty) : sql`qty`},
      price = ${data.price !== undefined ? (data.price == null ? null : Number(data.price)) : sql`price`},
      note = ${data.note !== undefined ? (data.note.trim().slice(0, 200) || null) : sql`note`},
      checked = ${data.checked !== undefined ? data.checked === true : sql`checked`}
    where id = ${id}
  `;
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  await sql`delete from material_shopping_items where id = ${id} and status = 'pending'`;
  return Response.json({ ok: true });
}
