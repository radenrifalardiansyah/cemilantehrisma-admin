import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import type { StallRow } from '@/lib/consign-pg';
import { auditConsign } from '@/lib/consign-audit';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consign', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) return Response.json({ error: 'Nama lapak wajib diisi.' }, { status: 400 });

  const sql = getSql();
  const [before] = await sql<StallRow[]>`select * from stalls where id = ${id}`;
  if (!before) return Response.json({ error: 'Lapak tidak ditemukan.' }, { status: 404 });
  const warehouseId = typeof data.warehouseId === 'string' && data.warehouseId ? data.warehouseId : null;
  if (warehouseId) {
    const [w] = await sql`select id from warehouses where id = ${warehouseId}`;
    if (!w) return Response.json({ error: 'Gudang terkait tidak ditemukan.' }, { status: 400 });
  }
  const isActive = data.isActive !== false;
  await sql`
    update stalls set name = ${name}, address = ${(data.address as string) ?? ''}, warehouse_id = ${warehouseId},
      note = ${(data.note as string) ?? ''}, is_active = ${isActive}, updated_at = now()
    where id = ${id}
  `;
  await auditConsign(guard, 'update', 'stalls', id, `Lapak ${name}`,
    { name: before.name, warehouseId: before.warehouse_id, isActive: before.is_active },
    { name, warehouseId, isActive });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consign', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const [before] = await sql<StallRow[]>`select * from stalls where id = ${id}`;
  if (!before) return Response.json({ error: 'Lapak tidak ditemukan.' }, { status: 404 });

  // Tolak kalau lapak sudah punya riwayat stok/dokumen — hapus akan menghilangkan jejak audit.
  // Lapak yang tidak dipakai lagi cukup dinonaktifkan.
  const [{ used }] = await sql<{ used: boolean }[]>`
    select (exists(select 1 from consign_stall_items where stall_id = ${id})
         or exists(select 1 from consign_receipts where stall_id = ${id})) as used
  `;
  if (used) {
    return Response.json({ error: 'Lapak ini sudah punya data titipan/riwayat — tidak bisa dihapus. Nonaktifkan saja.' }, { status: 400 });
  }
  await sql`delete from stalls where id = ${id}`;
  await auditConsign(guard, 'delete', 'stalls', id, `Lapak ${before.name}`, { name: before.name, code: before.code }, null);
  return Response.json({ ok: true });
}
