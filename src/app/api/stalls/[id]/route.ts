import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import type { StallRow } from '@/lib/consign-pg';
import { normalizeInvoicePrefix } from '@/lib/stall-access';
import { auditConsign } from '@/lib/consign-audit';
import { validateStallUsernames } from '../validate';

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
  const staff = await validateStallUsernames(sql, data.usernames);
  if ('error' in staff) return Response.json({ error: staff.error }, { status: 400 });

  const prefix = normalizeInvoicePrefix(data.invoicePrefix);
  if (!prefix) return Response.json({ error: 'Awalan invoice hanya huruf/angka/tanda hubung, 2–12 karakter.' }, { status: 400 });
  const others = await sql<{ code: string | null; invoice_prefix: string | null }[]>`select code, invoice_prefix from stalls where id <> ${id}`;
  if (others.some(r => (r.invoice_prefix ?? r.code ?? '').toUpperCase() === prefix)) {
    return Response.json({ error: `Awalan invoice "${prefix}" sudah dipakai lapak lain.` }, { status: 400 });
  }

  const isActive = data.isActive !== false;
  await sql.begin(async tx => {
    await tx`
      update stalls set name = ${name}, address = ${(data.address as string) ?? ''}, warehouse_id = ${warehouseId},
        note = ${(data.note as string) ?? ''}, is_active = ${isActive}, invoice_prefix = ${prefix}, updated_at = now()
      where id = ${id}
    `;
    // Petugas diganti sebagai satu set: yang tidak ada di daftar baru dilepas.
    await tx`delete from stall_users where stall_id = ${id}`;
    for (const username of staff.usernames) {
      await tx`insert into stall_users (stall_id, username, created_at) values (${id}, ${username}, now())`;
    }
  });
  await auditConsign(guard, 'update', 'stalls', id, `Lapak ${name}`,
    { name: before.name, warehouseId: before.warehouse_id, isActive: before.is_active, invoicePrefix: before.invoice_prefix },
    { name, warehouseId, isActive, invoicePrefix: prefix, usernames: staff.usernames });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consign', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const sql = getSql();
  const [before] = await sql<StallRow[]>`select * from stalls where id = ${id}`;
  if (!before) return Response.json({ error: 'Lapak tidak ditemukan.' }, { status: 404 });

  // Tolak kalau lapak sudah punya riwayat stok/dokumen/kas — hapus akan menghilangkan jejak audit.
  // Lapak yang tidak dipakai lagi cukup dinonaktifkan.
  const [{ used }] = await sql<{ used: boolean }[]>`
    select (exists(select 1 from consign_stall_items where stall_id = ${id})
         or exists(select 1 from consign_receipts where stall_id = ${id})
         or exists(select 1 from stall_wallet_entries where stall_id = ${id})) as used
  `;
  if (used) {
    return Response.json({ error: 'Lapak ini sudah punya data titipan/riwayat — tidak bisa dihapus. Nonaktifkan saja.' }, { status: 400 });
  }
  await sql.begin(async tx => {
    await tx`delete from stall_users where stall_id = ${id}`;
    await tx`delete from stalls where id = ${id}`;
  });
  await auditConsign(guard, 'delete', 'stalls', id, `Lapak ${before.name}`, { name: before.name, code: before.code }, null);
  return Response.json({ ok: true });
}
