import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';

const LOCATION_CODE_PREFIX = 'MTR';

interface LocationRow {
  id: string; name: string; code: string | null; contact_name: string | null; contact_phone: string | null;
  address: string | null; note: string | null; created_at: Date; updated_at: Date | null;
}
function rowToLocation(r: LocationRow) {
  return {
    id: r.id, name: r.name, code: r.code ?? '', contactName: r.contact_name ?? '', contactPhone: r.contact_phone ?? '',
    address: r.address ?? '', note: r.note ?? '',
    createdAt: r.created_at.toISOString(), updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
  };
}

const getCachedLocations = unstable_cache(
  async () => {
    const sql = getSql();
    const rows = await sql<LocationRow[]>`select * from consignment_locations order by created_at asc`;
    const locations = rows.map(rowToLocation);

    let maxCode = 0;
    for (const l of locations) {
      const m = /^MTR(\d+)$/i.exec(l.code.trim());
      if (m) maxCode = Math.max(maxCode, parseInt(m[1], 10));
    }
    const missing = locations.filter(l => !l.code.trim());
    for (const l of missing) {
      maxCode += 1;
      const code = `${LOCATION_CODE_PREFIX}${String(maxCode).padStart(3, '0')}`;
      l.code = code;
      await sql`update consignment_locations set code = ${code}, updated_at = now() where id = ${l.id}`;
    }
    return locations;
  },
  ['admin-consignment-locations'],
  { revalidate: 20 },
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'consignment', 'view');
  if (guard instanceof Response) return guard;
  const locations = await getCachedLocations();
  return Response.json({ locations });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'consignment', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const sql = getSql();
  const codeTrim = typeof data.code === 'string' ? data.code.trim() : '';
  if (codeTrim) {
    const [dup] = await sql<{ id: string }[]>`select id from consignment_locations where code = ${codeTrim} limit 1`;
    if (dup) {
      return Response.json({ error: `Kode "${codeTrim}" sudah digunakan lokasi lain.` }, { status: 409 });
    }
  }
  const id = randomUUID();
  const payload = {
    name: data.name as string, code: codeTrim,
    contactName: (data.contactName as string) ?? '', contactPhone: (data.contactPhone as string) ?? '',
    address: (data.address as string) ?? '', note: (data.note as string) ?? '',
  };
  await sql`
    insert into consignment_locations (id, name, code, contact_name, contact_phone, address, note, created_at, updated_at)
    values (${id}, ${payload.name}, ${payload.code}, ${payload.contactName}, ${payload.contactPhone}, ${payload.address}, ${payload.note}, now(), now())
  `;
  try {
    await logHistory(db, {
      entity: 'consignment',
      entityCollection: 'consignmentLocations',
      entityId: id,
      entityLabel: payload.name || id,
      action: 'create',
      actor: guard,
      after: payload,
    });
  } catch {}
  return Response.json({ id });
}
