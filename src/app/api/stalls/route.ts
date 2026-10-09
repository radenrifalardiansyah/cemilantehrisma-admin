import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { rowToStall, nextCode, type StallRow } from '@/lib/consign-pg';
import { auditConsign } from '@/lib/consign-audit';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'consign', 'view');
  if (guard instanceof Response) return guard;
  const sql = getSql();
  const rows = await sql<StallRow[]>`select * from stalls order by created_at asc`;
  return Response.json({ stalls: rows.map(rowToStall) });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'consign', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) return Response.json({ error: 'Nama lapak wajib diisi.' }, { status: 400 });

  const sql = getSql();
  const warehouseId = typeof data.warehouseId === 'string' && data.warehouseId ? data.warehouseId : null;
  if (warehouseId) {
    const [w] = await sql`select id from warehouses where id = ${warehouseId}`;
    if (!w) return Response.json({ error: 'Gudang terkait tidak ditemukan.' }, { status: 400 });
  }
  const id = randomUUID();
  const existing = await sql<{ code: string | null }[]>`select code from stalls`;
  const code = nextCode('LPK', existing.map(r => r.code));
  await sql`
    insert into stalls (id, code, name, address, warehouse_id, note, is_active, created_at, updated_at)
    values (${id}, ${code}, ${name}, ${(data.address as string) ?? ''}, ${warehouseId}, ${(data.note as string) ?? ''}, ${data.isActive !== false}, now(), now())
  `;
  await auditConsign(guard, 'create', 'stalls', id, `Lapak ${name}`, null, { code, name, warehouseId });
  return Response.json({ id, code });
}
