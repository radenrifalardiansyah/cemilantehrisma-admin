import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
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
  revalidateTag('admin-consignment-locations', { expire: 0 });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requirePermission(req, 'consignment', 'delete');
  if (guard instanceof Response) return guard;
  const { id } = await ctx.params;
  const db = getDb();
  const sql = getSql();

  // Tolak kalau lokasi ini masih punya riwayat apapun — stok titip (termasuk yang sudah 0),
  // pengiriman, atau rekap. Kalau dibolehkan, riwayat itu jadi yatim permanen (tidak bisa
  // ditelusuri lagi karena lokasinya sudah tidak ada untuk dipilih).
  const [{ count: stockCount }] = await sql<{ count: string }[]>`select count(*)::int as count from consignment_stock where location_id = ${id}`;
  if (Number(stockCount) > 0) {
    return Response.json(
      { error: 'Lokasi ini masih punya catatan stok titip — rekap atau kosongkan dulu sebelum menghapus.' },
      { status: 400 },
    );
  }
  const [{ count: shipmentCount }] = await sql<{ count: string }[]>`select count(*)::int as count from consignment_shipments where location_id = ${id}`;
  if (Number(shipmentCount) > 0) {
    return Response.json(
      { error: 'Lokasi ini masih punya riwayat pengiriman — tidak bisa dihapus.' },
      { status: 400 },
    );
  }
  const [{ count: recapCount }] = await sql<{ count: string }[]>`select count(*)::int as count from consignment_recaps where location_id = ${id}`;
  if (Number(recapCount) > 0) {
    return Response.json(
      { error: 'Lokasi ini masih punya riwayat rekap — tidak bisa dihapus.' },
      { status: 400 },
    );
  }

  const [before] = await sql<LocationRow[]>`select name, code, contact_name, contact_phone, address, note from consignment_locations where id = ${id}`;
  try {
    await sql`delete from consignment_locations where id = ${id}`;
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23503') {
      return Response.json({ error: 'Tidak bisa dihapus — lokasi ini masih direferensikan data lain.' }, { status: 400 });
    }
    throw err;
  }
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
  revalidateTag('admin-consignment-locations', { expire: 0 });
  return Response.json({ ok: true });
}
