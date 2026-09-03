import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { WAREHOUSES_LIST_VIEW_KEYS } from '@/lib/permissions';
import { logHistory } from '@/lib/history';

interface WarehouseRow { id: string; name: string; location: string | null; description: string | null; created_at: Date; updated_at: Date | null }
function rowToWarehouse(r: WarehouseRow) {
  return {
    id: r.id, name: r.name, location: r.location ?? '', description: r.description ?? '',
    createdAt: r.created_at.toISOString(), updatedAt: r.updated_at ? r.updated_at.toISOString() : null,
  };
}

const getCachedWarehouses = unstable_cache(
  async () => {
    const sql = getSql();
    const rows = await sql<WarehouseRow[]>`select * from warehouses order by created_at asc`;
    return rows.map(rowToWarehouse);
  },
  ['admin-warehouses'],
  { revalidate: 20, tags: ['admin-warehouses'] },
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, WAREHOUSES_LIST_VIEW_KEYS, 'view');
  if (guard instanceof Response) return guard;
  const warehouses = await getCachedWarehouses();
  return Response.json({ warehouses });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'settings', 'edit');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const db = getDb();
  const sql = getSql();
  const id = randomUUID();
  const payload = { name: data.name as string, location: (data.location as string) ?? '', description: (data.description as string) ?? '' };
  await sql`
    insert into warehouses (id, name, location, description, created_at, updated_at)
    values (${id}, ${payload.name}, ${payload.location}, ${payload.description}, now(), now())
  `;

  try {
    await logHistory(db, {
      entity: 'warehouses',
      entityId: id,
      entityLabel: payload.name ?? id,
      action: 'create',
      actor: guard,
      after: payload,
    });
  } catch {
    // audit log failure must never fail the business request
  }

  revalidateTag('admin-warehouses', { expire: 0 });
  return Response.json({ id });
}
