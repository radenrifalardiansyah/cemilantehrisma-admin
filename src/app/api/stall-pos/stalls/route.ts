import { NextRequest } from 'next/server';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { userStallIds } from '@/lib/stall-access';
import type { StallRow } from '@/lib/consign-pg';
import { rowToShift, type ShiftRow } from '@/lib/stall-pos-server';

// Lapak yang boleh dipakai akun ini di Kasir Lapak (+ shift yang sedang terbuka di tiap lapak).
export async function GET(req: NextRequest) {
  const user = await requirePermission(req, 'stall-pos', 'view');
  if (user instanceof Response) return user;
  const ids = await userStallIds(user);
  const sql = getSql();
  const stalls = ids === 'all'
    ? await sql<StallRow[]>`select * from stalls where is_active order by name`
    : ids.length === 0 ? [] : await sql<StallRow[]>`select * from stalls where is_active and id in ${sql(ids)} order by name`;
  const shifts = stalls.length === 0 ? [] : await sql<ShiftRow[]>`select * from stall_shifts where status = 'open' and stall_id in ${sql(stalls.map(s => s.id))}`;
  const shiftByStall = new Map(shifts.map(s => [s.stall_id, rowToShift(s)]));
  return Response.json({
    stalls: stalls.map(s => ({
      id: s.id, code: s.code ?? '', name: s.name, address: s.address, warehouseId: s.warehouse_id ?? '',
      invoicePrefix: s.invoice_prefix ?? s.code ?? '', shift: shiftByStall.get(s.id) ?? null,
    })),
  });
}
