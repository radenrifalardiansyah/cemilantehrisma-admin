import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { loadConsignCatalog } from '@/lib/store-consign';
import type { StallRow } from '@/lib/consign-pg';

// Barang titipan yang bisa dijual lewat Kasir toko: stok titipan di lapak bertanda "Toko".
// storeStall = null kalau belum ada lapak Toko (tab Titipan di kasir disembunyikan).
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'pos', 'view');
  if (guard instanceof Response) return guard;
  const sql = getSql();
  const [stall] = await sql<StallRow[]>`select * from stalls where is_store and is_active`;
  if (!stall) return Response.json({ storeStall: null, items: [] });
  return Response.json({ storeStall: { id: stall.id, name: stall.name }, items: await loadConsignCatalog(sql, stall.id) });
}
