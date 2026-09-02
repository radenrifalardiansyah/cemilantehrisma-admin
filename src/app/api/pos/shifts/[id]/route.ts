import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getSql } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { logHistory } from '@/lib/history';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const user = await requirePermission(req, 'pos', 'edit');
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const { actualBalance, note } = await req.json() as { actualBalance: number; note?: string };

  const db = getDb();
  const ref = db.collection('cashierShifts').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return Response.json({ error: 'Sesi kasir tidak ditemukan.' }, { status: 404 });
  const shift = snap.data()!;
  if (shift.status !== 'open') return Response.json({ error: 'Sesi kasir sudah ditutup.' }, { status: 409 });

  // `orders` pindah ke Postgres (Tahap 12 migrasi Fase 2 — lihat plan gleaming-wondering-quokka.md).
  const sql = getSql();
  const [{ total }] = await sql<{ total: string }[]>`
    select coalesce(sum(total), 0) as total from orders where shift_id = ${id} and payment_method = 'cash'
  `;
  const cashSalesTotal = Number(total) || 0;

  const openingBalance = Number(shift.openingBalance) || 0;
  const expectedBalance = openingBalance + cashSalesTotal;
  const actual = Number(actualBalance) || 0;
  const difference = actual - expectedBalance;

  await ref.update({
    status: 'closed',
    closedAt: FieldValue.serverTimestamp(),
    closedBy: user.username,
    cashSalesTotal,
    expectedBalance,
    actualBalance: actual,
    difference,
    closeNote: note?.trim() ?? '',
  });

  const updated = await ref.get();
  const updatedData = updated.data();
  try {
    await logHistory(db, {
      entity: 'pos',
      entityCollection: 'cashierShifts',
      entityId: ref.id,
      entityLabel: `Sesi kasir ${shift.openedBy ?? user.username}`,
      action: 'update',
      actor: user,
      before: shift,
      after: updatedData,
    });
  } catch (err) {
    console.error('Failed to write history for pos shift update', err);
  }
  return Response.json({ shift: { id: ref.id, ...updatedData } });
}
