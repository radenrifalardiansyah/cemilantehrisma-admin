import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, 'expenses', 'delete');
  if (guard instanceof Response) return guard;
  const { ids } = await req.json() as { ids: string[] };
  if (!Array.isArray(ids) || ids.length === 0)
    return Response.json({ error: 'ids required' }, { status: 400 });

  const sql = getSql();
  // Lewati entri yang otomatis dari sumber lain (mis. Pembelian Bahan Baku) — supaya tidak
  // membuat status pembayaran/stok di sumbernya jadi tidak sinkron.
  const rows = await sql<{ id: string; source_type: string | null }[]>`
    select id, source_type from expenses where id in ${sql(ids)}
  `;
  const deletableIds = rows.filter(r => !r.source_type).map(r => r.id);
  const skipped = ids.length - deletableIds.length;

  if (deletableIds.length > 0) {
    await sql`delete from expenses where id in ${sql(deletableIds)}`;
  }
  revalidateTag('admin-expenses', { expire: 0 });
  return Response.json({ deleted: deletableIds.length, skipped });
}
