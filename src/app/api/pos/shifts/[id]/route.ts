import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { logHistory } from '@/lib/history';

type Ctx = { params: Promise<{ id: string }> };
interface ShiftRow {
  id: string; opened_by: string | null; opening_balance: string | null; note: string | null; status: string;
  closed_at: Date | null; closed_by: string | null;
  cash_sales_total: string | null; expected_balance: string | null; actual_balance: string | null;
  difference: string | null; close_note: string | null;
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const user = await requirePermission(req, 'pos', 'edit');
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const { actualBalance, note } = await req.json() as { actualBalance: number; note?: string };

  const db = getDb();
  const sql = getSql();
  const [shift] = await sql<ShiftRow[]>`select * from cashier_shifts where id = ${id}`;
  if (!shift) return Response.json({ error: 'Sesi kasir tidak ditemukan.' }, { status: 404 });
  if (shift.status !== 'open') return Response.json({ error: 'Sesi kasir sudah ditutup.' }, { status: 409 });

  // `orders` pindah ke Postgres (Tahap 12 migrasi Fase 2 — lihat plan gleaming-wondering-quokka.md).
  const [{ total }] = await sql<{ total: string }[]>`
    select coalesce(sum(total), 0) as total from orders where shift_id = ${id} and payment_method = 'cash'
  `;
  const cashSalesTotal = Number(total) || 0;

  const openingBalance = Number(shift.opening_balance) || 0;
  const expectedBalance = openingBalance + cashSalesTotal;
  const actual = Number(actualBalance) || 0;
  const difference = actual - expectedBalance;
  const closeNote = note?.trim() ?? '';

  await sql`
    update cashier_shifts set
      status = 'closed', closed_at = now(), closed_by = ${user.username},
      cash_sales_total = ${cashSalesTotal}, expected_balance = ${expectedBalance},
      actual_balance = ${actual}, difference = ${difference}, close_note = ${closeNote}
    where id = ${id}
  `;

  const updatedData = {
    openedBy: shift.opened_by, openingBalance, note: shift.note ?? '', status: 'closed',
    closedBy: user.username, cashSalesTotal, expectedBalance, actualBalance: actual, difference, closeNote,
  };
  try {
    await logHistory(db, {
      entity: 'pos',
      entityCollection: 'cashierShifts',
      entityId: id,
      entityLabel: `Sesi kasir ${shift.opened_by ?? user.username}`,
      action: 'update',
      actor: user,
      before: { openedBy: shift.opened_by, openingBalance, note: shift.note ?? '', status: shift.status },
      after: updatedData,
    });
  } catch (err) {
    console.error('Failed to write history for pos shift update', err);
  }
  return Response.json({ shift: { id, ...updatedData } });
}
