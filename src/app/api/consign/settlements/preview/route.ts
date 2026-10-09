import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { DATE_RE, loadUnsettledLines } from '@/lib/consign-settlement';

// Pratinjau rekap (tanpa menyimpan): apa saja yang akan masuk untuk lapak × penitip × periode.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'consign', 'view');
  if (guard instanceof Response) return guard;
  const sp = new URL(req.url).searchParams;
  const stallId = sp.get('stallId') ?? '';
  const consignorId = sp.get('consignorId') ?? '';
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  if (!stallId || !consignorId || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return Response.json({ error: 'Lapak, penitip, dan periode wajib diisi.' }, { status: 400 });
  }
  const sql = getSql();
  const found = await sql.begin(tx => loadUnsettledLines(tx, { stallId, consignorId, from, to }));
  return Response.json({ items: found.items, total: found.total, count: found.count });
}
