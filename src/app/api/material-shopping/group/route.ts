import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

// Aksi untuk satu daftar belanja (kumpulan item dengan tanggal + supplier yang sama), dikirim
// sebagai daftar id item — hanya item yang masih menunggu (belum diproses) yang terpengaruh.

// Ubah tanggal / supplier / catatan satu daftar.
export async function PUT(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'edit');
  if (guard instanceof Response) return guard;
  const data = await req.json() as { ids?: string[]; date?: string; supplierId?: string; supplierName?: string; note?: string };
  const ids = Array.isArray(data.ids) ? data.ids : [];
  if (ids.length === 0) return Response.json({ error: 'Tidak ada item.' }, { status: 400 });
  if (!data.date || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) return Response.json({ error: 'Tanggal wajib diisi.' }, { status: 400 });
  const sql = getSql();
  await sql`
    update material_shopping_items set
      shopping_date = ${data.date}, supplier_id = ${data.supplierId || null},
      supplier_name = ${(data.supplierName ?? '').trim().slice(0, 120)}, note = ${data.note?.trim().slice(0, 200) || null}
    where id in ${sql(ids)} and status = 'pending'
  `;
  return Response.json({ ok: true });
}

// Hapus satu daftar (semua item yang belum diproses di dalamnya).
export async function DELETE(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids?: string[] };
  if (!Array.isArray(ids) || ids.length === 0) return Response.json({ error: 'Tidak ada item.' }, { status: 400 });
  const sql = getSql();
  await sql`delete from material_shopping_items where id in ${sql(ids)} and status = 'pending'`;
  return Response.json({ ok: true });
}
