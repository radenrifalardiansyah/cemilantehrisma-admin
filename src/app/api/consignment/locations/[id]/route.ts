import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';

type Ctx = { params: Promise<{ id: string }> };
interface LocationRow { name: string; code: string | null; contact_name: string | null; contact_phone: string | null; address: string | null; note: string | null }

export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'edit');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const sql = getSql();
  const codeTrim = typeof data.code === 'string' ? data.code.trim() : '';
  if (codeTrim) {
    const [dup] = await sql<{ id: string }[]>`select id from consignment_locations where code = ${codeTrim} limit 1`;
    if (dup && dup.id !== id) {
      return Response.json({ error: `Kode "${codeTrim}" sudah digunakan lokasi lain.` }, { status: 409 });
    }
  }
  const [before] = await sql<LocationRow[]>`select name, code, contact_name, contact_phone, address, note from consignment_locations where id = ${id}`;
  const payload = {
    name: data.name as string, code: codeTrim,
    contactName: (data.contactName as string) ?? '', contactPhone: (data.contactPhone as string) ?? '',
    address: (data.address as string) ?? '', note: (data.note as string) ?? '',
  };
  await sql`
    update consignment_locations set
      name = ${payload.name}, code = ${payload.code}, contact_name = ${payload.contactName},
      contact_phone = ${payload.contactPhone}, address = ${payload.address}, note = ${payload.note}, updated_at = now()
    where id = ${id}
  `;
  try {
    await logHistory(db, {
      entity: 'consignment',
      entityCollection: 'consignmentLocations',
      entityId: id,
      entityLabel: (typeof data.name === 'string' && data.name) || before?.name || id,
      action: 'update',
      actor: guard,
      before,
      after: { ...before, ...payload },
    });
  } catch {}
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const sql = getSql();

  // Tolak kalau masih ada stok titip tersisa di lokasi ini — kalau dibolehkan, stok itu jadi
  // yatim permanen (tidak bisa direkap lagi karena lokasinya sudah tidak ada untuk dipilih).
  const [{ count }] = await sql<{ count: string }[]>`select count(*)::int as count from consignment_stock where location_id = ${id} and stock_qty > 0`;
  if (Number(count) > 0) {
    return Response.json(
      { error: 'Lokasi ini masih punya stok titip tersisa — rekap atau kosongkan dulu sebelum menghapus.' },
      { status: 400 },
    );
  }

  const [before] = await sql<LocationRow[]>`select name, code, contact_name, contact_phone, address, note from consignment_locations where id = ${id}`;
  await sql`delete from consignment_locations where id = ${id}`;
  try {
    await logHistory(db, {
      entity: 'consignment',
      entityCollection: 'consignmentLocations',
      entityId: id,
      entityLabel: before?.name || id,
      action: 'delete',
      actor: guard,
      before,
    });
  } catch {}
  return Response.json({ ok: true });
}
