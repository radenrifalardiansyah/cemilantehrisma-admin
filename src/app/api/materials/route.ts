import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { rowToMaterial, type MaterialRow } from '@/lib/materials-pg';

// Was the one uncached GET in the dashboard's fetch fan-out (products/customers/resellers
// etc. already use this same pattern) — fires on every session restore. (Tahap 18b migrasi
// Fase 2 — lihat plan gleaming-wondering-quokka.md.)
const getCachedMaterials = unstable_cache(
  async () => {
    const sql = getSql();
    const rows = await sql<MaterialRow[]>`select * from raw_materials order by created_at asc`;
    return rows.map(rowToMaterial);
  },
  ['admin-materials'],
  { revalidate: 15, tags: ['admin-materials'] },
);

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'view');
  if (guard instanceof Response) return guard;
  const materials = await getCachedMaterials();
  return Response.json({ materials });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'create');
  if (guard instanceof Response) return guard;
  const data = await req.json() as Record<string, unknown>;
  const sql = getSql();
  const id = randomUUID();
  await sql`
    insert into raw_materials (id, name, unit, min_stock, stock_qty, avg_cost, created_at, updated_at)
    values (${id}, ${data.name as string}, ${(data.unit as string) ?? ''}, ${Number(data.minStock) || 0}, 0, 0, now(), now())
  `;
  revalidateTag('admin-materials', { expire: 0 });
  return Response.json({ id });
}
