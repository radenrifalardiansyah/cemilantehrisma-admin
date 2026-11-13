import { NextRequest } from 'next/server';
import { requirePermission } from '@/lib/rbac';
import { loadPayableRows } from '@/lib/payables-pg';
import { groupPayablesBySupplier, summarizePayables } from '@/lib/payables-core';

// Rekap Hutang Supplier: per supplier (total hutang, jumlah pembelian, jatuh tempo terdekat, yang lewat jatuh tempo)
// beserta daftar pembeliannya. `?summary=1` hanya mengembalikan ringkasan (dipakai banner peringatan). Hanya baca.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'materials', 'view');
  if (guard instanceof Response) return guard;
  const rows = await loadPayableRows();
  const summary = summarizePayables(rows);
  if (new URL(req.url).searchParams.get('summary') === '1') return Response.json({ summary });
  return Response.json({ summary, suppliers: groupPayablesBySupplier(rows) });
}
