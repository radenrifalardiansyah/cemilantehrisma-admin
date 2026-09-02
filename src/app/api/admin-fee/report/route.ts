import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/rbac';
import { computeReport } from '@/lib/admin-fee';

export async function GET(req: NextRequest) {
  const guard = await requireSuperAdmin(req);
  if (guard instanceof Response) return guard;
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!from || !to) return Response.json({ error: 'Parameter from dan to wajib diisi.' }, { status: 400 });

  const report = await computeReport(from, to);
  return Response.json(report);
}
