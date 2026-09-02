import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { referencedMaterialIds } from '@/lib/materials';

type Ctx = { params: Promise<{ id: string }> };

// Cuma nama & satuan yang bisa diedit di sini — stockQty & avgCost hanya
// berubah lewat /api/material-purchases (masuk) & /api/production (keluar).
export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  const sql = getSql();
  await sql`
    update raw_materials set name = ${data.name as string}, unit = ${(data.unit as string) ?? ''},
      min_stock = ${Number(data.minStock) || 0}, updated_at = now()
    where id = ${id}
  `;
  revalidateTag('admin-materials', { expire: 0 });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'materials', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;

  const referenced = await referencedMaterialIds();
  if (referenced.has(id)) {
    return Response.json(
      { error: 'Bahan baku ini masih dipakai di riwayat pembelian atau produksi — tidak bisa dihapus.' },
      { status: 400 },
    );
  }

  const sql = getSql();
  await sql`delete from raw_materials where id = ${id}`;
  revalidateTag('admin-materials', { expire: 0 });
  return Response.json({ ok: true });
}
