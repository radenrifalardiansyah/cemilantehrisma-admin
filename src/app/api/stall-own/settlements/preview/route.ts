import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { DATE_RE, loadUnsettledOwnLines } from '@/lib/stall-own';

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, 'stall-own', 'view');
  if (guard instanceof Response) return guard;
  const sp = new URL(req.url).searchParams;
  const stallId = sp.get('stallId') ?? ''; const from = sp.get('from') ?? ''; const to = sp.get('to') ?? '';
  if (!stallId || !DATE_RE.test(from) || !DATE_RE.test(to) || from > to) return Response.json({ error: 'Parameter tidak valid.' }, { status: 400 });
  const sql = getSql();
  const found = await sql.begin(tx => loadUnsettledOwnLines(tx, { stallId, from, to }));
  return Response.json({ items: found.items, total: found.total, count: found.count });
}
