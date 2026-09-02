import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

interface ImportRow { name: string; unit: string }

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'create');
  if (guard instanceof Response) return guard;
  const { materials } = await req.json() as { materials: ImportRow[] };
  if (!Array.isArray(materials) || materials.length === 0) {
    return Response.json({ error: 'Tidak ada data bahan baku untuk diimpor.' }, { status: 400 });
  }

  const sql = getSql();
  const existingRows = await sql<{ name: string }[]>`select name from raw_materials`;
  const existingNames = new Set(existingRows.map(r => (r.name ?? '').trim().toLowerCase()).filter(Boolean));
  const seenNames = new Set<string>();

  let created = 0, skippedInvalid = 0, skippedDuplicate = 0;

  for (const row of materials) {
    const name = (row.name ?? '').toString().trim();
    const unit = (row.unit ?? '').toString().trim();
    if (!name || !unit) { skippedInvalid++; continue; }
    const key = name.toLowerCase();
    if (existingNames.has(key) || seenNames.has(key)) { skippedDuplicate++; continue; }

    seenNames.add(key);
    try {
      await sql`
        insert into raw_materials (id, name, unit, min_stock, stock_qty, avg_cost, created_at, updated_at)
        values (${randomUUID()}, ${name}, ${unit}, 0, 0, 0, now(), now())
      `;
      created++;
    } catch (err) {
      console.error('Bulk import bahan baku: gagal menyimpan baris', name, err);
      skippedInvalid++;
    }
  }

  if (created > 0) revalidateTag('admin-materials', { expire: 0 });
  return Response.json({ created, skippedInvalid, skippedDuplicate });
}
