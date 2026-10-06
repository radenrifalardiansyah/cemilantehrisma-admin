import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { stockAdjustmentForPeriod } from '@/lib/stock-adjustment-pg';

// Selisih stok opname per periode — dipakai Laporan Keuangan (Laba Rugi).
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'finance-report', 'view');
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!from || !to) return Response.json({ error: 'Parameter from & to (yyyy-mm-dd) wajib diisi.' }, { status: 400 });
  return Response.json(await stockAdjustmentForPeriod(getSql(), from, to));
}
