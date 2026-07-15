import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase-admin';
import { getAuthUser, unauthorized } from '@/lib/admin-auth';
import { FieldValue } from 'firebase-admin/firestore';

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx) {
  const user = getAuthUser(req);
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  const { actualBalance, note } = await req.json() as { actualBalance: number; note?: string };

  const db = getDb();
  const ref = db.collection('cashierShifts').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return Response.json({ error: 'Sesi kasir tidak ditemukan.' }, { status: 404 });
  const shift = snap.data()!;
  if (shift.status !== 'open') return Response.json({ error: 'Sesi kasir sudah ditutup.' }, { status: 409 });

  const ordersSnap = await db.collection('orders').where('shiftId', '==', id).get();
  const cashSalesTotal = ordersSnap.docs
    .map(d => d.data())
    .filter(o => o.paymentMethod === 'cash')
    .reduce((sum, o) => sum + (Number(o.total) || 0), 0);

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
  return Response.json({ shift: { id: ref.id, ...updated.data() } });
}
