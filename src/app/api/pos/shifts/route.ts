import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';
import { notify } from '@/lib/notifications';

interface ShiftRow {
  id: string; opened_by: string | null; opening_balance: string | null; note: string | null; status: string;
  opened_at: Date; closed_at: Date | null; closed_by: string | null;
  cash_sales_total: string | null; expected_balance: string | null; actual_balance: string | null;
  difference: string | null; close_note: string | null;
}
function rowToShift(r: ShiftRow) {
  return {
    id: r.id, openedBy: r.opened_by, openingBalance: r.opening_balance != null ? Number(r.opening_balance) : 0,
    note: r.note ?? '', status: r.status,
    openedAt: { seconds: Math.floor(r.opened_at.getTime() / 1000), nanoseconds: 0 },
    closedAt: r.closed_at ? { seconds: Math.floor(r.closed_at.getTime() / 1000), nanoseconds: 0 } : null,
    closedBy: r.closed_by, cashSalesTotal: r.cash_sales_total != null ? Number(r.cash_sales_total) : undefined,
    expectedBalance: r.expected_balance != null ? Number(r.expected_balance) : undefined,
    actualBalance: r.actual_balance != null ? Number(r.actual_balance) : undefined,
    difference: r.difference != null ? Number(r.difference) : undefined,
    closeNote: r.close_note ?? undefined,
  };
}

export async function GET(req: NextRequest) {
  const user = await requirePermission(req, 'pos', 'view');
  if (user instanceof Response) return user;
  const sql = getSql();
  const [row] = await sql<ShiftRow[]>`select * from cashier_shifts where status = 'open' limit 1`;
  return Response.json({ shift: row ? rowToShift(row) : null });
}

export async function POST(req: NextRequest) {
  const user = await requirePermission(req, 'pos', 'create');
  if (user instanceof Response) return user;
  const { openingBalance, note } = await req.json() as { openingBalance: number; note?: string };

  const db = getDb();
  const sql = getSql();
  const id = randomUUID();
  const shiftData = {
    openedBy: user.username,
    openingBalance: Number(openingBalance) || 0,
    note: note?.trim() ?? '',
    status: 'open',
  };
  try {
    // "Cuma boleh 1 shift open" ditegakkan oleh unique partial index di Postgres
    // (cashier_shifts_one_open_idx, where status = 'open') — INSERT kedua yang bentrok gagal
    // dengan error 23505 (unique_violation), bukan lagi lewat baca-lalu-tulis dalam satu
    // transaksi Firestore seperti versi lama.
    await sql`
      insert into cashier_shifts (id, opened_by, opening_balance, note, status, opened_at)
      values (${id}, ${shiftData.openedBy}, ${shiftData.openingBalance}, ${shiftData.note}, 'open', now())
    `;
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
      return Response.json({ error: 'Sudah ada sesi kasir yang terbuka.' }, { status: 409 });
    }
    throw err;
  }
  try {
    await logHistory(db, {
      entity: 'pos',
      entityCollection: 'cashierShifts',
      entityId: id,
      entityLabel: `Sesi kasir ${shiftData?.openedBy ?? user.username}`,
      action: 'create',
      actor: user,
      after: shiftData,
    });
  } catch (err) {
    console.error('Failed to write history for pos shift create', err);
  }
  try {
    await notify(db, {
      type: 'pos_shift_open',
      title: 'Shift kasir dibuka',
      message: `${user.username} membuka sesi kasir dengan modal awal Rp${(Number(openingBalance) || 0).toLocaleString('id-ID')}.`,
      link: 'pos',
      entityCollection: 'cashierShifts', entityId: id,
      actor: user,
    });
  } catch (err) {
    console.error('Failed to write notification for pos shift open', err);
  }
  return Response.json({ shift: { id, ...shiftData } });
}
